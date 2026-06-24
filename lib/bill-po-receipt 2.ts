import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Apply a bill's PO receipt: increment PurchaseOrderLine.receivedQty for each
 * bill line linked to a PO line, then recompute + flip the affected PurchaseOrder
 * status (PARTIAL_RECEIVED / CLOSED).
 *
 * MUST run EXACTLY ONCE, when the bill is FINALIZED to OPEN — whether finalized
 * directly (approval off) or via approval (held -> approved). It must NOT run
 * while the bill is held (PENDING_APPROVAL) and must NOT run if the bill is
 * rejected. The single-finalize status transition (DRAFT/PENDING_APPROVAL ->
 * OPEN happens once) is what guarantees once-only application — every caller is
 * gated on that transition.
 *
 * Self-contained: operates purely from persisted data given (tx, orgId, billId)
 * so the approval finalizer can call it the same way the create/PUT paths do.
 * The bill-line -> PO-line linking (purchaseOrderLineId) is persisted at create
 * time, so this only reads it back.
 *
 * Already-received lines: a bill produced by the goods-receipt workflow
 * (POST /purchase-orders/[id]/receive) already incremented receivedQty AT
 * RECEIPT TIME and booked inventory cost layers against the bill. Re-applying
 * here would double-count the receipt. We detect that case the same way
 * postBillToLedger does — an InventoryLot already exists for this bill
 * (documentType=PURCHASE, documentId=billId) — and no-op. Direct bills pulled
 * from a PO have no such lots yet, so they apply the receipt here.
 */
export async function applyBillPoReceipt(tx: Tx, orgId: string, billId: string): Promise<void> {
  // Goods-receipt bills already booked their receipt (receivedQty + cost layers)
  // at receipt time — re-applying would double-count. Same signal as
  // postBillToLedger's `receiptAlreadyBooked`.
  const receiptAlreadyBooked =
    (await tx.inventoryLot.count({
      where: { organizationId: orgId, documentType: InventoryDocumentType.PURCHASE, documentId: billId },
    })) > 0;
  if (receiptAlreadyBooked) return;

  const lines = await tx.billLine.findMany({
    where: { billId, purchaseOrderLineId: { not: null } },
    select: { quantity: true, purchaseOrderLineId: true },
  });
  if (lines.length === 0) return;

  // Increment receivedQty on each linked PO line; collect affected POs.
  const affectedPoIds = new Set<string>();
  for (const line of lines) {
    const poLineId = line.purchaseOrderLineId as string;
    const updated = await tx.purchaseOrderLine.update({
      where: { id: poLineId },
      data: { receivedQty: { increment: Number(line.quantity) } },
      select: { purchaseOrderId: true },
    });
    affectedPoIds.add(updated.purchaseOrderId);
  }

  // Recompute + flip each affected PO's status from its (now updated) lines.
  for (const purchaseOrderId of affectedPoIds) {
    const poLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId },
      select: { quantity: true, receivedQty: true },
    });
    const allFull = poLines.every((pl) => Number(pl.receivedQty) >= Number(pl.quantity) - 0.0001);
    const anyReceived = poLines.some((pl) => Number(pl.receivedQty) > 0.0001);
    const newPoStatus = allFull ? 'CLOSED' : anyReceived ? 'PARTIAL_RECEIVED' : undefined;
    if (newPoStatus) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: newPoStatus as never },
      });
    }
  }
}
