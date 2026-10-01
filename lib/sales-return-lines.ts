import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { advisoryLockKey } from './advisory-lock';
import { toNumber } from './money';

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
export async function prepareSalesReturnLines(
  tx: Tx, orgId: string, invoiceId: string, customerId: string,
  lines: ReturnLineInput[], excludeReturnId?: string,
) {
  await lockSalesReturns(tx, orgId, invoiceId);
  const invoice = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { lines: true },
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
  });
  const quantities = new Map<string, number>();
  for (const line of prior) {
    if (toNumber(line.qtyReturn) <= 0) continue;
    const source = resolve(line);
    quantities.set(source.id, (quantities.get(source.id) ?? 0) + toNumber(line.qtyReturn));
  }
  return lines.map((line) => {
    const source = resolve(line);
    const qty = toNumber(line.qtyReturn);
    const totalQty = (quantities.get(source.id) ?? 0) + qty;
    if (!Number.isFinite(qty) || qty < 0 || totalQty > toNumber(source.quantity) + 0.00001) {
      throw new ApiError(`Return quantity exceeds the remaining sold quantity for ${source.description}`, 422);
    }
    quantities.set(source.id, totalQty);
    return {
      sourceInvoiceLineId: source.id,
      goodsReceived: line.goodsReceived ?? true,
      itemId: source.itemId,
      itemName: source.description,
      qtySold: toNumber(source.quantity),
      source,
    };
  });
}

/** Recover old costs only when the historical outbound ledger is unambiguous. */
export async function originalSalesLineCost(tx: Tx, orgId: string, source: {
  id: string; invoiceId: string; itemId: string | null; quantity: unknown; cogsAmount: unknown;
}): Promise<number> {
  if (source.cogsAmount != null) return toNumber(source.cogsAmount);
  const siblings = await tx.salesInvoiceLine.count({
    where: { invoiceId: source.invoiceId, itemId: source.itemId },
  });
  const ledger = await tx.inventoryLedgerEntry.findMany({
    where: {
      organizationId: orgId, documentId: source.invoiceId, documentType: 'SALES',
      itemId: source.itemId!, qtyOut: { gt: 0 },
    },
  });
  const qty = ledger.reduce((sum, l) => sum + toNumber(l.qtyOut), 0);
  if (siblings !== 1 || !ledger.length || Math.abs(qty - toNumber(source.quantity)) > 0.00001) {
    throw new ApiError('Original sale cost is unavailable for this item. Review the historical invoice cost before receiving its return.', 422);
  }
  const cost = -ledger.reduce((sum, l) => sum + toNumber(l.valueChange), 0);
  if (cost < 0) throw new ApiError('Invalid original sale cost', 422);
  await tx.salesInvoiceLine.update({ where: { id: source.id }, data: { cogsAmount: cost } });
  return cost;
}
