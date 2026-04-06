// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { calculateSalesOrderTotal, CreditLimitError, enforceCustomerCreditLimit } from '@/lib/credit-limit';
import { updateSalesOrderInputSchema } from '@/types/api';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const so = await prisma.salesOrder.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true },
    });
    if (!so) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(so));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const body = await req.json();
    const parsed = updateSalesOrderInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid sales order payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { customerName, customerId, issueDate, expiryDate, number, notes, status, items } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) return null;
      const resolvedCustomerId = customerId === undefined ? existing.customerId : (customerId || null);
      const resolvedCustomerName = customerName ?? existing.customerName;

      if (resolvedCustomerId) {
        await validateForeignKey(tx.customer, { id: resolvedCustomerId, organizationId: orgId, status: 'ACTIVE' }, 'Customer not found in organization');
        if (items) {
          await enforceCustomerCreditLimit(tx, {
            organizationId: orgId,
            customerId: resolvedCustomerId,
            customerName: resolvedCustomerName,
            documentAmount: calculateSalesOrderTotal(items),
          });
        }
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          ...(customerName !== undefined && { customerName }),
          ...(customerId  !== undefined && { customerId }),
          ...(issueDate   !== undefined && { issueDate:  new Date(issueDate) }),
          ...(expiryDate  !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
          ...(number      !== undefined && { number }),
          ...(notes       !== undefined && { notes }),
          ...(status      !== undefined && { status: status.toUpperCase() }),
          ...(items       !== undefined && {
            items: {
              deleteMany: {},
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
          }),
        },
        include: { items: true },
      });
    });

    if (!updated) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    if (error instanceof CreditLimitError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed to update sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const result = await prisma.salesOrder.deleteMany({ where: { id, organizationId: orgId } });
    if (result.count === 0) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: id, action: 'DELETE' });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
