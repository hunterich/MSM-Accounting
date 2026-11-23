import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { advisoryLockKey } from './advisory-lock';
import { MoneyDecimal } from './money-decimal';
import { calculateSalesReturnAmounts } from './sales-return-amounts';

type Tx = Prisma.TransactionClient;
interface ReturnLineInput {
  sourceInvoiceLineId?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  description?: string | null;
  qtyReturn?: unknown;
  goodsReceived?: boolean;
}

/** Serialize reservations and posting for an invoice, including parallel returns. */
export async function lockSalesReturns(tx: Tx, orgId: string, invoiceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`sales-returns:${orgId}:${invoiceId}`)})`;
}

/** Bind return lines to the actual sale and enforce cumulative return quantities. */
async function loadSalesReturnLines(
  tx: Tx, orgId: string, invoiceId: string, customerId: string,
  lines: ReturnLineInput[], excludeReturnId?: string,
) {
  await lockSalesReturns(tx, orgId, invoiceId);
  const invoice = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, charges: true },
  });
  if (!invoice || invoice.customerId !== customerId) {
    throw new ApiError('Source invoice must belong to the selected customer and organization', 422);
  }
  if (invoice.status === 'VOID') throw new ApiError('Cannot return a voided invoice', 422);

  const resolve = (line: ReturnLineInput) => {
    const candidates = line.sourceInvoiceLineId
      ? invoice.lines.filter((l) => l.id === line.sourceInvoiceLineId)
      : invoice.lines.filter((l) => line.itemId
        ? l.itemId === line.itemId
        : !l.itemId && l.description === (line.itemName || line.description || ''));
    if (candidates.length !== 1) {
      throw new ApiError('Select the exact source invoice line for each returned item', 422);
    }
    const source = candidates[0];
    if ((line.itemId || null) !== source.itemId) {
      throw new ApiError('Returned item does not match its source invoice line', 422);
    }
    return source;
  };

  const prior = await tx.salesReturnLine.findMany({
    where: { salesReturn: {
      organizationId: orgId, invoiceId, status: { not: 'VOID' },
      ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
    } },
    orderBy: [{ salesReturnId: 'asc' }, { lineNo: 'asc' }],
    include: { salesReturn: { select: { status: true, taxAmount: true, taxIncluded: true, applyTax: true } } },
  });
  const quantities = new Map<string, Prisma.Decimal>();
  const priorLines = prior.filter(line => new MoneyDecimal(line.qtyReturn).gt(0))
    .map(line => ({ ...line, sourceId: resolve(line).id }));
  for (const line of priorLines) {
    quantities.set(line.sourceId, new MoneyDecimal(quantities.get(line.sourceId) ?? 0).plus(line.qtyReturn));
  }
  const prepared = lines.map((line) => {
    const source = resolve(line);
    const qtyReturn = new MoneyDecimal(line.qtyReturn == null ? 0 : line.qtyReturn as Prisma.Decimal.Value).toDecimalPlaces(4);
    const totalQty = new MoneyDecimal(quantities.get(source.id) ?? 0).plus(qtyReturn);
    if (!qtyReturn.isFinite() || qtyReturn.lt(0) || totalQty.gt(source.quantity)) {
      throw new ApiError(`Return quantity exceeds the remaining sold quantity for ${source.description}`, 422);
    }
    quantities.set(source.id, totalQty);
    return {
      sourceInvoiceLineId: source.id,
      goodsReceived: line.goodsReceived ?? true,
      itemId: source.itemId,
      itemName: source.description,
      qtySold: source.quantity,
      qtyReturn,
      source,
    };
  });
  return { invoice, prepared, priorLines };
}

export async function prepareSalesReturnLines(
  tx: Tx, orgId: string, invoiceId: string, customerId: string, lines: ReturnLineInput[], excludeReturnId?: string,
) {
  return (await loadSalesReturnLines(tx, orgId, invoiceId, customerId, lines, excludeReturnId)).prepared;
}

export async function prepareSalesReturnValuation(
  tx: Tx, orgId: string, invoiceId: string, customerId: string, lines: ReturnLineInput[], excludeReturnId?: string,
) {
  const { invoice, prepared, priorLines } = await loadSalesReturnLines(tx, orgId, invoiceId, customerId, lines, excludeReturnId);
  // Drafts reserve quantity, while their final monetary amount is assigned on submission.
  const amounts = calculateSalesReturnAmounts(invoice, prepared, priorLines.filter(line => line.salesReturn.status !== 'DRAFT'));
  return { invoice, prepared, amounts };
}

/** Recover old costs only when the historical outbound ledger is unambiguous. */
export async function originalSalesLineCost(tx: Tx, orgId: string, source: {
  id: string; invoiceId: string; itemId: string | null; quantity: Prisma.Decimal.Value; cogsAmount: Prisma.Decimal.Value | null;
}): Promise<Prisma.Decimal> {
  if (source.cogsAmount != null) return new MoneyDecimal(source.cogsAmount);
  const siblings = await tx.salesInvoiceLine.count({
    where: { invoiceId: source.invoiceId, itemId: source.itemId },
  });
  const ledger = await tx.inventoryLedgerEntry.findMany({
    where: {
      organizationId: orgId, documentId: source.invoiceId, documentType: 'SALES',
      itemId: source.itemId!, qtyOut: { gt: 0 },
    },
  });
  const qty = ledger.reduce((sum, line) => sum.plus(line.qtyOut), new MoneyDecimal(0));
  if (siblings !== 1 || !ledger.length || !qty.eq(source.quantity)) {
    throw new ApiError('Original sale cost is unavailable for this item. Review the historical invoice cost before receiving its return.', 422);
  }
  const cost = ledger.reduce((sum, line) => sum.minus(line.valueChange), new MoneyDecimal(0));
  if (cost.lt(0)) throw new ApiError('Invalid original sale cost', 422);
  await tx.salesInvoiceLine.update({ where: { id: source.id }, data: { cogsAmount: cost } });
  return cost;
}
