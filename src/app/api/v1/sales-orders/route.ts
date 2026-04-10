import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, listResponse, logAudit, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler } from '@/lib/api-utils';
import { calculateSalesOrderTotal, enforceCustomerCreditLimit } from '@/lib/credit-limit';
import { salesOrderInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 200 });
  const status = searchParams.get('status') || undefined;

  const where: any = { organizationId: orgId };
  if (status) where.status = status.toUpperCase();

  const [data, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.salesOrder.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId  = requireOrg(req);
  const userId = req.headers.get('x-user-id');

  const body = await req.json();
  const parsed = salesOrderInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid sales order payload', 400);
  }
  const { customerName, customerId, issueDate, expiryDate, number, notes, status, items } = parsed.data;

  const so = await prisma.$transaction(async (tx) => {
    if (customerId) {
      await validateForeignKey(tx.customer, { id: customerId, organizationId: orgId, status: 'ACTIVE' }, 'Customer not found in organization');
      await enforceCustomerCreditLimit(tx, {
        organizationId: orgId,
        customerId,
        customerName,
        documentAmount: calculateSalesOrderTotal(items),
      });
    }

    return tx.salesOrder.create({
      data: {
        organizationId: orgId,
        customerName,
        customerId: customerId || null,
        issueDate:  issueDate  ? new Date(issueDate)  : new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        number:     number     || null,
        notes:      notes      || null,
        status,
        items: {
          create: items.map((item: any) => ({
            productId:   item.productId   || null,
            code:        item.code        || null,
            description: item.description || '',
            quantity:    item.quantity    ?? 1,
            unit:        item.unit        || 'PCS',
            price:       item.price       ?? 0,
            discount:    item.discount    ?? 0,
          })),
        },
      },
      include: { items: true },
    });
  });

  logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: so.id, action: 'CREATE' });
  return ok(so, 201);
});
