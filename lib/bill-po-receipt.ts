import type { Prisma } from '@prisma/client';
import { calculateBillAmounts } from './bill-totals';
import { ApiError } from './errors';
import { postGoodsReceiptToLedger } from './goods-receipt-posting';
import { lockInventoryItems } from './inventory-costing';
import { allocatePoReceiptLine, updatePoReceiptStatus } from './po-receipt-amounts';
import { lockPurchaseOrder } from './purchase-order-auto-close';

type Tx = Prisma.TransactionClient;
type BillWithLines = Prisma.BillGetPayload<{ include: { lines: true; charges: true } }>;

export async function lockPurchaseOrdersForBill(tx: Tx, orgId: string, lineIds: string[]) {
  if (!lineIds.length) return;
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { id: { in: lineIds }, purchaseOrder: { organizationId: orgId } },
    select: { purchaseOrderId: true },
  });
  for (const poId of [...new Set(poLines.map(line => line.purchaseOrderId))].sort()) {
    await lockPurchaseOrder(tx, poId);
  }
}

/** Receive goods on a direct PO bill when it becomes payable. A goods-receipt
 * draft already owns its stock and its allocated value. */
export async function applyBillPoReceipt(tx: Tx, orgId: string, bill: BillWithLines) {
  const lines = bill.lines.filter(line => line.purchaseOrderLineId);
  if (!lines.length || bill.receiptPostingJournalId || lines.some(line => line.poReceiptTaxAmount != null)) return;
  if (await tx.inventoryLot.count({
    where: { organizationId: orgId, documentType: 'PURCHASE', documentId: bill.id },
  })) return;

  const poLineIds = lines.map(line => line.purchaseOrderLineId!);
  if (new Set(poLineIds).size !== poLineIds.length) {
    throw new ApiError('Each purchase order line may only appear once in a receipt', 422);
  }
  await lockPurchaseOrdersForBill(tx, orgId, poLineIds);
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { id: { in: poLineIds }, purchaseOrder: { organizationId: orgId } },
    include: { purchaseOrder: true },
  });
  const byId = new Map(poLines.map(line => [line.id, line]));
  const receiptLines: BillWithLines['lines'] = [];
  const poNumbers = new Map<string, string>();
  for (const line of lines) {
    const poLine = byId.get(line.purchaseOrderLineId!);
    if (!poLine || (bill.poId && bill.poId !== poLine.purchaseOrderId) || poLine.purchaseOrder.vendorId !== bill.vendorId) {
      throw new ApiError('Purchase order line does not belong to this vendor or bill', 422);
    }
    const po = poLine.purchaseOrder;
    if (!['APPROVED', 'PARTIAL_RECEIVED'].includes(po.status)) {
      throw new ApiError('PO must be APPROVED or PARTIAL_RECEIVED to receive goods', 422);
    }
    const taxable = po.taxable && poLine.taxable !== false;
    if (line.itemId !== poLine.itemId || line.unit !== poLine.unit || !line.price.eq(poLine.price)
      || !line.discountPct.eq(poLine.discountPct)
      || taxable !== (bill.taxable && line.taxable !== false)
      || (taxable && (bill.taxInclusive !== po.taxInclusive || !bill.taxRate.eq(po.taxRate)))) {
      throw new ApiError('The bill item, unit, price, discount, and tax treatment must match the purchase order before receiving goods.', 422);
    }
    const allocated = await allocatePoReceiptLine(tx, orgId, po, poLine, line.quantity, bill.id);
    receiptLines.push(await tx.billLine.update({ where: { id: line.id }, data: allocated }));
    await tx.purchaseOrderLine.update({
      where: { id: poLine.id },
      data: { receivedQty: { increment: allocated.quantity } },
    });
    poNumbers.set(po.id, po.number);
  }

  for (const poId of poNumbers.keys()) await updatePoReceiptStatus(tx, orgId, poId);
  const receiptById = new Map(receiptLines.map(line => [line.id, line]));
  const updatedLines = bill.lines.map(line => receiptById.get(line.id) ?? line);
  const { subtotal, taxAmount, withholdingAmount, totalAmount } = calculateBillAmounts({ ...bill, lines: updatedLines });
  const updated = await tx.bill.update({
    where: { id: bill.id, organizationId: orgId },
    data: { subtotal, taxAmount, withholdingAmount, totalAmount },
  });
  // Both receipt stock and any separate bill stock must be locked before
  // journal numbering, in the same order used by other stock postings.
  await lockInventoryItems(tx, orgId, updatedLines.flatMap(line => line.itemId ? [line.itemId] : []));
  await postGoodsReceiptToLedger(tx, orgId, {
    billId: bill.id, poNumber: [...poNumbers.values()].join(', '), date: bill.issueDate,
    taxInclusive: bill.taxable && bill.taxInclusive, taxRate: bill.taxRate, lines: receiptLines,
  });
  return { ...bill, ...updated, lines: updatedLines };
}
