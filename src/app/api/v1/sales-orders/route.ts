import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { calculateSalesOrderTotal, enforceCustomerCreditLimit } from '@/lib/credit-limit';
import { salesOrderInputSchema } from '@/types/api';
import { routeForApproval } from '@/lib/approval/engine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 200 });
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const customerId = searchParams.get('customerId');

  const where: any = { organizationId: orgId };
  if (status) where.status = status.toUpperCase();
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { customerName: { contains: search, mode: 'insensitive' } },
  ];
  if (dateFrom || dateTo) {
    where.issueDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
    };
  }
  if (customerId) where.customerId = customerId;

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

export const POST = withPermission({ module: 'AR_SALES_ORDERS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId  = requireOrg(req);
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);

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

    const created = await tx.salesOrder.create({
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

    // Gate create-as-CONFIRMED through the approval engine.
    // DRAFT creates pass through unchanged.
    if (created.status === 'CONFIRMED') {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'SALES_ORDER',
        documentId: created.id,
      });
      if (routed) {
        // HELD for approval: override to PENDING_APPROVAL, skip any finalisation.
        await tx.salesOrder.update({
          where: { id: created.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
        (created as any).status = 'PENDING_APPROVAL';
      }
    }

    return created;
  });

  logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: so.id, action: 'CREATE' });
  return ok(so, 201);
});
