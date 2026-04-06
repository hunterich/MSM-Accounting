// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { calculateSalesOrderTotal, CreditLimitError, enforceCustomerCreditLimit } from '@/lib/credit-limit';
import { salesOrderInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(200, Number(searchParams.get('limit') ?? 50));
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

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list sales orders';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const body = await req.json();
    const parsed = salesOrderInputSchema.safeParse({
      ...body,
      organizationId: orgId,
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid sales order payload', issues: parsed.error.issues }, { status: 400 }));
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
    return withCors(NextResponse.json(so, { status: 201 }));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    if (error instanceof CreditLimitError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed to create sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
