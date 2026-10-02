/**
 * Inventory valuation derived from the immutable inventory ledger
 * (`InventoryLedgerEntry`) — the SAME source the GL inventory account is posted
 * from. Summing `valueChange` per item reconciles with the GL inventory balance
 * by construction under BOTH FIFO and weighted-average costing.
 *
 * Why not the open cost layers (`InventoryLot`)? Under weighted-average the
 * layers keep their original per-layer costs while the ledger relieves
 * consumption at the blended rate, so a lot-sum can diverge from GL (a known
 * cost-layer model gap). Reporting from the ledger keeps the valuation report in
 * lockstep with the trial balance.
 */
import type { Prisma } from '@prisma/client';
import { toNumber, asMoney } from './money';

type LedgerReader = Pick<Prisma.TransactionClient, 'inventoryLedgerEntry'>;

export interface ItemValuation {
  itemId: string;
  totalQty: number;
  totalValue: number;
}

/**
 * Aggregate on-hand quantity and value per item from the inventory ledger.
 *   - totalQty   = Σ(qtyIn − qtyOut)
 *   - totalValue = Σ(valueChange)   ← equals the GL inventory account balance
 *
 * `opts.itemIds` / `opts.warehouseId` scope the result (a warehouse filter
 * gives that warehouse's slice; omit it for the company-wide total that ties to
 * the GL inventory control account).
 */
export async function computeLedgerValuation(
  db: LedgerReader,
  orgId: string,
  opts?: { itemIds?: string[]; warehouseId?: string | null },
): Promise<Map<string, ItemValuation>> {
  const where: Prisma.InventoryLedgerEntryWhereInput = { organizationId: orgId };
  if (opts?.itemIds?.length) where.itemId = { in: opts.itemIds };
  if (opts?.warehouseId) where.warehouseId = opts.warehouseId;

  const rows = await db.inventoryLedgerEntry.groupBy({
    by: ['itemId'],
    where,
    _sum: { qtyIn: true, qtyOut: true, valueChange: true },
  });

  const map = new Map<string, ItemValuation>();
  for (const r of rows) {
    map.set(r.itemId, {
      itemId: r.itemId,
      totalQty: Math.round((toNumber(r._sum.qtyIn) - toNumber(r._sum.qtyOut)) * 10000) / 10000,
      totalValue: asMoney(toNumber(r._sum.valueChange)),
    });
  }
  return map;
}
