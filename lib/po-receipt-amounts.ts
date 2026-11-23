import type { Prisma, PurchaseOrderLine } from '@prisma/client';
import { calculateBillAmounts, splitBillLineTax } from './bill-totals';
import { ApiError } from './errors';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';

const ZERO = new MoneyDecimal(0);

type TaxTerms = { taxable: boolean; taxInclusive: boolean; taxRate: unknown };
type ReceiptPOLine = Pick<PurchaseOrderLine, 'id' | 'quantity' | 'receivedQty' | 'lineTotal' | 'taxable'>;

/** Allocate up to the rounded cumulative share, less the amounts actually received. */
export async function allocatePoReceiptLine(
  tx: Prisma.TransactionClient,
  orgId: string,
  po: TaxTerms,
  line: ReceiptPOLine,
  quantityInput: unknown,
  excludeBillId?: string,
) {
  const quantity = new MoneyDecimal(String(quantityInput)).toDecimalPlaces(4);
  const ordered = new MoneyDecimal(String(line.quantity));
  const received = new MoneyDecimal(String(line.receivedQty));
  const remaining = ordered.minus(received);
  if (!quantity.gt(0)) throw new ApiError('Receipt quantity must be at least 0.0001', 422);
  if (quantity.gt(remaining)) {
    throw new ApiError(`Over-receiving: only ${remaining.toFixed(4)} units remaining on line`, 422);
  }

  let priorNet = ZERO;
  let priorTax = ZERO;
  if (received.gt(0)) {
    const previous = await tx.billLine.findMany({
      where: {
        purchaseOrderLineId: line.id,
        ...(excludeBillId && { billId: { not: excludeBillId } }),
        bill: { organizationId: orgId, deletedAt: null },
      },
      include: { bill: { select: { receiptPostingJournalId: true, journalEntryId: true, taxable: true, taxInclusive: true, taxRate: true } } },
    });
    // Older zero-value receipts may have a stock movement and no receipt journal.
    const unmarkedIds = previous.filter(part => part.poReceiptTaxAmount == null && !part.bill.receiptPostingJournalId && !part.bill.journalEntryId).map(part => part.billId);
    const movements = unmarkedIds.length ? await tx.inventoryLedgerEntry.findMany({
      where: { organizationId: orgId, documentType: 'PURCHASE', documentId: { in: unmarkedIds } },
      select: { documentId: true },
      distinct: ['documentId'],
    }) : [];
    const stockReceiptIds = new Set(movements.map(part => part.documentId));
    let priorQuantity = ZERO;
    for (const part of previous) {
      if (part.poReceiptTaxAmount == null && !part.bill.receiptPostingJournalId && !part.bill.journalEntryId && !stockReceiptIds.has(part.billId)) continue;
      const [amounts] = calculateBillAmounts({ ...part.bill, lines: [part] }).lines;
      priorQuantity = priorQuantity.plus(String(part.quantity));
      priorNet = priorNet.plus(amounts.net);
      priorTax = priorTax.plus(amounts.tax);
    }
    if (!priorQuantity.eq(received)) {
      throw new ApiError('The quantities on earlier receipts do not match the PO. Review the earlier receipts before receiving more.', 422);
    }
  }

  const gross = roundMoneyDecimal(String(line.lineTotal));
  const rate = po.taxable && line.taxable !== false ? roundMoneyDecimal(String(po.taxRate)).div(100) : ZERO;
  const full = splitBillLineTax(gross, rate, po.taxInclusive);
  if (priorNet.gt(full.net) || priorTax.gt(full.tax)) {
    throw new ApiError('Earlier receipts exceed the PO line value or tax. Review the earlier receipts before receiving more.', 422);
  }
  const proportionalGross = roundMoneyDecimal(gross.mul(received.plus(quantity)).div(ordered));
  const target = splitBillLineTax(proportionalGross, rate, po.taxInclusive);
  // A reversed receipt can leave a retained cent above the intermediate target.
  // Carry it forward until the cumulative share catches up.
  const net = MoneyDecimal.max(ZERO, target.net.minus(priorNet));
  const tax = MoneyDecimal.max(ZERO, target.tax.minus(priorTax));
  return { quantity, lineTotal: po.taxInclusive ? net.plus(tax) : net, poReceiptTaxAmount: tax };
}

export async function updatePoReceiptStatus(tx: Prisma.TransactionClient, orgId: string, purchaseOrderId: string) {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId },
    select: { quantity: true, receivedQty: true },
  });
  const allFull = lines.every(line => new MoneyDecimal(String(line.receivedQty)).gte(String(line.quantity)));
  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId, organizationId: orgId },
    data: { status: allFull ? 'CLOSED' : 'PARTIAL_RECEIVED' },
  });
}
