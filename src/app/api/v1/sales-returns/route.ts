import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, validateForeignKey } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { routeForApproval } from '@/lib/approval/engine';
import { roundMoneyDecimal } from '@/lib/money-decimal';
import { createSalesReturnInputSchema } from '@/types/api';
import { lockSalesReturns, prepareSalesReturnValuation } from '@/lib/sales-return-lines';
import { assertReturnPreview } from '@/lib/note-return-value';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'AR_CREDITS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 100 });
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;

  const search = searchParams.get('search');
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { customer: { name: { contains: search, mode: 'insensitive' } } },
    { invoice: { number: { contains: search, mode: 'insensitive' } } },
  ];
  const [data, total] = await Promise.all([
    prisma.salesReturn.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: [{ returnDate: 'desc' }, { id: 'desc' }],
      include: {
        customer: { select: { id: true, name: true, code: true } },
        invoice: { select: { id: true, number: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    }),
    prisma.salesReturn.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'AR_CREDITS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);
  const body = await req.json();
  const parsed = createSalesReturnInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid sales return payload', 400);
  const { lines, expectedValuation, ...header } = parsed.data;

  const salesReturn = await prisma.$transaction(async (tx) => {
    await lockSalesReturns(tx, orgId, header.invoiceId);
    await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${header.invoiceId} AND "organizationId" = ${orgId} FOR UPDATE`;
    // Tenant isolation: the customer, the source invoice, and every referenced
    // line item must belong to this org — otherwise they leak back through the
    // GET `include` joins (customer / invoice / lines.item).
    await validateForeignKey(tx.customer, { id: header.customerId, organizationId: orgId }, 'Customer not found in organization');
    await validateForeignKey(tx.salesInvoice, { id: header.invoiceId, organizationId: orgId }, 'Invoice not found in organization');
    const returnItemIds = Array.from(
      new Set((lines ?? []).map((l: any) => l.itemId).filter((id: unknown): id is string => !!id)),
    );
    for (const itemId of returnItemIds) {
      await validateForeignKey(tx.item, { id: itemId, organizationId: orgId }, 'Item not found in organization');
    }
    const { invoice, prepared, amounts } = await prepareSalesReturnValuation(tx, orgId, header.invoiceId, header.customerId, lines ?? []);
    assertReturnPreview(amounts, expectedValuation);
    const number = await nextNumber(tx, 'SalesReturn', 'number', 'SRN');
    const created = await tx.salesReturn.create({
      data: {
        ...header,
        number,
        organizationId: orgId,
        returnDate: new Date(header.returnDate),
        subtotal: amounts.subtotal,
        taxAmount: amounts.taxAmount,
        totalAmount: amounts.totalAmount,
        applyTax: invoice.taxEnabled,
        taxIncluded: invoice.taxInclusive,
        taxRate: invoice.taxRate,
        lines: lines?.length ? {
          create: lines.map((line, idx) => ({
              lineNo:   idx + 1,
              sourceInvoiceLineId: prepared[idx].sourceInvoiceLineId,
              goodsReceived: prepared[idx].goodsReceived,
              itemId:   prepared[idx].itemId,
              itemName: prepared[idx].itemName,
              qtySold:  prepared[idx].qtySold,
              qtyReturn: prepared[idx].qtyReturn,
              unit:     line.unit || 'PCS',
              price: roundMoneyDecimal(line.price ?? 0),
              ...amounts.lines[idx],
          })),
        } : undefined,
      },
      include: { lines: true },
    });

    // Both direct approval and Save & Create Credit Note finalize the inventory
    // leg. PUT covers the corresponding draft transitions. If approval routes the
    // finalize for approval first, hold the return at PENDING_APPROVAL and post NO GL.
    if (created.status === 'APPROVED' || created.status === 'PENDING_CREDIT_NOTE') {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'SALES_RETURN',
        documentId: created.id,
      });
      if (routed) {
        await tx.salesReturn.update({
          where: { id: created.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
      } else {
        await postSalesReturnOnApproval(tx, created.id, dateOverride);
      }
    }

    return tx.salesReturn.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: salesReturn.id, action: 'CREATE', payload: { number: salesReturn.number } });
  return ok(salesReturn, 201);
});
