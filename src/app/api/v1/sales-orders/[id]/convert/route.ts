import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, requireAuth, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { nextInvoiceNumber } from '@/lib/invoice-number';
import { calculateInvoiceTotals } from '@/lib/invoice-totals';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AR_SALES_ORDERS', action: 'create' }, async (req: NextRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    const { orgId, userId } = requireAuth(req);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SalesOrder" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
      const so = await tx.salesOrder.findFirst({ where: { id, organizationId: orgId }, include: { items: true } });
      if (!so) throw new ApiError('Sales order not found', 404);
      if (so.status === 'INVOICED' || so.invoiceId) throw new ApiError('Sales order already invoiced', 400);
      if (so.status === 'CANCELLED') throw new ApiError('Cannot convert a cancelled sales order', 400);
      if (!so.customerId) throw new ApiError('Sales order must have a customer to convert', 400);
      await validateForeignKey(tx.customer, { id: so.customerId, organizationId: orgId }, 'Customer not found in organization');
      const defaults = await tx.organization.findUniqueOrThrow({
        where: { id: orgId }, select: { taxEnabled: true, taxDefaultRate: true, taxInclusiveByDefault: true },
      });
      const totals = calculateInvoiceTotals({
        lines: so.items.map(item => ({
          itemId: item.productId,
          code: item.code,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          price: item.price,
          discountPct: item.discount,
        })),
      }, defaults);
      const issueDate = new Date();
      const number = await nextInvoiceNumber(tx, orgId, { issueDate });

      const invoice = await tx.salesInvoice.create({
        data: {
          organizationId: orgId,
          createdById:    userId,
          number,
          customerId:     so.customerId,
          invoiceType:    'Sales Invoice',
          issueDate,
          status:         'DRAFT',
          notes:          so.notes || null,
          soId:           so.id,
          currency:       'IDR',
          subtotal:       totals.subtotal,
          discountPct:    totals.discountPct,
          discountAmount: totals.discountAmount,
          taxEnabled:     totals.taxEnabled,
          taxInclusive:   totals.taxInclusive,
          taxRate:        totals.taxRate,
          taxAmount:      totals.taxAmount,
          totalAmount:    totals.totalAmount,
          lines: { create: totals.lines },
        },
        include: { lines: true },
      });

      await tx.salesOrder.update({
      where: { id: so.id, organizationId: orgId },
        data:  { status: 'INVOICED', invoiceId: invoice.id },
      });

      return invoice;
    });

    logAudit({ orgId, actorId: userId, entityType: 'SalesInvoice', entityId: result.id, action: 'CREATE', payload: { fromSO: id } });
    return withCors(NextResponse.json({ invoice: result, salesOrderId: id }, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to convert sales order';
    return withCors(NextResponse.json({ error: message }, { status: error instanceof ApiError ? error.status : 500 }));
  }
});
