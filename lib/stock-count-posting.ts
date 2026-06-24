import type { Prisma } from '@prisma/client';
import { toNumber, asMoney } from './money';
import { nextNumber } from './api-utils';
import { postStockAdjustmentToLedger, type StockAdjustmentPostingLine } from './stock-adjustment-posting';

const QTY_EPSILON = 1e-6;

export interface CountLineInput {
  itemId: string;
  systemQty: unknown;   // snapshot (display only — not used for the posted variance)
  countedQty: unknown;  // null/undefined = not counted (skipped)
  unitCost: unknown;
}

/**
 * Build the StockAdjustment posting lines from a count.
 * - Only lines with a counted quantity are considered (blank = skipped).
 * - The variance is measured against LIVE on-hand (`liveQtyByItem`), so the
 *   posted adjustment moves the book to exactly the counted quantity.
 * - Zero-variance lines are dropped.
 */
export function buildCountAdjustmentLines(
  lines: CountLineInput[],
  liveQtyByItem: Record<string, number>,
): Array<StockAdjustmentPostingLine & { oldQty: number; newQty: number; qtyDiff: number; unitCost: number }> {
  const out: Array<{ itemId: string; oldQty: number; newQty: number; qtyDiff: number; unitCost: number }> = [];
  for (const l of lines) {
    if (l.countedQty === null || l.countedQty === undefined || l.countedQty === '') continue;
    const counted = toNumber(l.countedQty);
    const live = liveQtyByItem[l.itemId] ?? 0;
    const qtyDiff = counted - live;
    if (Math.abs(qtyDiff) < QTY_EPSILON) continue;
    out.push({ itemId: l.itemId, oldQty: live, newQty: counted, qtyDiff, unitCost: toNumber(l.unitCost) });
  }
  return out;
}

type Tx = Prisma.TransactionClient;

/**
 * Generate + post the StockAdjustment for a SUBMITTED count, in one transaction.
 * Re-reads live on-hand per item so the book becomes exactly the counts.
 * Returns the generated adjustment id (or null when nothing varied).
 */
export async function postStockCount(
  tx: Tx,
  orgId: string,
  count: { id: string; number: string; date: Date; warehouseId: string | null; lines: CountLineInput[] },
): Promise<string | null> {
  const itemIds = count.lines.map((l) => l.itemId);
  const lotRows = itemIds.length
    ? await tx.inventoryLot.groupBy({
        by: ['itemId'],
        where: { organizationId: orgId, itemId: { in: itemIds } },
        _sum: { qtyBalance: true },
      })
    : [];
  const liveQtyByItem: Record<string, number> = {};
  for (const r of lotRows) liveQtyByItem[r.itemId] = toNumber(r._sum.qtyBalance ?? 0);

  const adjLines = buildCountAdjustmentLines(count.lines, liveQtyByItem);
  if (adjLines.length === 0) return null;

  const number = await nextNumber(tx, 'StockAdjustment', 'number', 'ADJ');
  const adj = await tx.stockAdjustment.create({
    data: {
      organizationId: orgId,
      number,
      date: count.date,
      type: 'QUANTITY',
      reason: `Stock count ${count.number}`,
      warehouseId: count.warehouseId,
      status: 'APPROVED',
    },
  });
  await tx.stockAdjustmentLine.createMany({
    data: adjLines.map((l, idx) => ({
      stockAdjustmentId: adj.id,
      lineNo: idx + 1,
      itemId: l.itemId,
      oldQty: l.oldQty,
      newQty: l.newQty,
      qtyDiff: l.qtyDiff,
      unitCost: l.unitCost,
      totalValue: asMoney(l.qtyDiff * l.unitCost),
    })),
  });
  await postStockAdjustmentToLedger(tx, orgId, {
    id: adj.id,
    number: adj.number,
    date: count.date,
    warehouseId: null, // cost layers are warehouse-agnostic; StockCount.warehouseId is metadata-only (multi-warehouse deferred)
    lines: adjLines,
  });
  return adj.id;
}
