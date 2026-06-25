import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Cascade an adjustment void back to the StockCount that generated it.
 *
 * Posting a stock count generates a StockAdjustment and links it via
 * `StockCount.generatedAdjustmentId`. That adjustment can be voided directly
 * (Inventory Adjustments UI), which reverses the GL + inventory but would
 * otherwise leave the count showing POSTED with a live `/journal`. This moves
 * the owning count to the terminal VOIDED state so its status + journal stop
 * contradicting the reversed accounting.
 *
 * Layering note: stock-count depends on stock-adjustment, never the reverse, so
 * `voidStockAdjustment` stays unaware of counts — the void route orchestrates
 * both in one transaction. Call this AFTER the adjustment is marked VOID.
 *
 * The `generatedAdjustmentId` link is intentionally kept (audit trail); the
 * journal route is made VOID-aware separately. Returns the voided count id, or
 * null when the adjustment was not count-generated (or its count isn't POSTED).
 */
export async function voidStockCountForAdjustment(
  tx: Tx,
  orgId: string,
  adjustmentId: string,
): Promise<string | null> {
  const count = await tx.stockCount.findFirst({
    where: { generatedAdjustmentId: adjustmentId, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!count || count.status !== 'POSTED') return null;

  await tx.stockCount.update({ where: { id: count.id }, data: { status: 'VOIDED' } });
  return count.id;
}
