import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { asMoney, toNumber } from './money';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { addCostLayer, relieveCostLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

export interface StockAdjustmentPostingLine {
  itemId: string;
  oldQty: unknown;
  newQty: unknown;
  qtyDiff?: unknown;
  unitCost: unknown;
}

export interface StockAdjustmentPostingArgs {
  /** StockAdjustment.id — recorded as the ledger/GL documentId. */
  id: string;
  /** StockAdjustment.number — used for memos/descriptions. */
  number: string;
  date: Date;
  warehouseId: string | null;
  lines: StockAdjustmentPostingLine[];
}

/** Per-line signed quantity delta (newQty - oldQty unless an explicit diff is given). */
function lineQtyDiff(l: StockAdjustmentPostingLine): number {
  return toNumber(l.qtyDiff ?? (Number(l.newQty) - Number(l.oldQty)));
}

/**
 * Post the inventory ledger + cost layers + balancing journal entry for a stock
 * adjustment. Each line drives the shared cost-layer helpers so lots and the
 * ledger move together:
 *   - increase (qtyDiff > 0): addCostLayer at the typed unit cost (new layer + ledger row).
 *   - decrease (qtyDiff < 0): relieveCostLayers at carrying cost (FIFO/WA) + ledger row.
 * The single net journal entry is posted from those lot-derived values, so
 * lots = ledger = GL by construction (FIFO; see the WA note in the integration tests).
 * Adjustments are never blocked on insufficient layers — a shortfall is valued at
 * item.costPrice (consumeFIFO's fallback).
 */
export async function postStockAdjustmentToLedger(
  tx: Tx,
  orgId: string,
  args: StockAdjustmentPostingArgs,
): Promise<void> {
  const lines = args.lines ?? [];
  if (lines.length === 0) return;

  let netValue = 0;
  for (const l of lines) {
    const qtyDiff = lineQtyDiff(l);
    if (qtyDiff > 0) {
      const unitCost = toNumber(l.unitCost);
      await addCostLayer(
        tx, orgId, l.itemId, args.warehouseId ?? null,
        qtyDiff, unitCost, InventoryDocumentType.ADJUSTMENT, args.id, args.date,
      );
      netValue += asMoney(qtyDiff * unitCost);
    } else if (qtyDiff < 0) {
      const cost = await relieveCostLayers(
        tx, orgId, l.itemId, args.warehouseId ?? null,
        -qtyDiff, InventoryDocumentType.ADJUSTMENT, args.id, args.date,
      );
      netValue -= cost;
    }
    // qtyDiff === 0 → no movement
  }

  const netRounded = asMoney(netValue);
  if (Math.abs(netRounded) === 0) return;

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const varianceAccountId =
    resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') ||
    resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  if (!inventoryAccountId || !varianceAccountId) return;

  const memo = `Stock adjustment: ${args.number}`;
  if (netRounded > 0) {
    await postJournalEntry(tx, {
      organizationId: orgId,
      date: args.date,
      memo,
      lines: [
        { accountId: inventoryAccountId, description: `Inventory increase - ${args.number}`, debit: netRounded, credit: 0 },
        { accountId: varianceAccountId,  description: `Stock variance - ${args.number}`,    debit: 0,           credit: netRounded },
      ],
    });
  } else {
    const amount = -netRounded;
    await postJournalEntry(tx, {
      organizationId: orgId,
      date: args.date,
      memo,
      lines: [
        { accountId: varianceAccountId,  description: `Stock variance - ${args.number}`,    debit: amount, credit: 0 },
        { accountId: inventoryAccountId, description: `Inventory decrease - ${args.number}`, debit: 0,     credit: amount },
      ],
    });
  }
}
