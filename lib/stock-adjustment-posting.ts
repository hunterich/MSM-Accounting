import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { asMoney, toNumber } from './money';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';

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
 * Post the inventory ledger + balancing journal entry for a stock adjustment.
 *
 * For every line, an `InventoryLedgerEntry` (documentType ADJUSTMENT) is written
 * with a signed `valueChange = qtyDiff × unitCost`. The net value across all
 * lines posts ONE journal entry: an increase debits Inventory and credits the
 * variance account; a decrease does the reverse. A net of zero posts no entry
 * (the per-line ledger rows still capture the detail).
 *
 * NOTE: this deliberately does NOT touch `InventoryLot` cost layers — purchases
 * and sales own lot tracking; adjustments only correct quantity/value. That gap
 * means on-hand *lot* valuation can drift from the ledger/GL after an
 * adjustment; see the stock-adjustment integration tests.
 */
export async function postStockAdjustmentToLedger(
  tx: Tx,
  orgId: string,
  args: StockAdjustmentPostingArgs,
): Promise<void> {
  const lines = args.lines ?? [];
  if (lines.length === 0) return;

  await tx.inventoryLedgerEntry.createMany({
    data: lines.map((l) => {
      const qtyDiff = lineQtyDiff(l);
      const unitCost = toNumber(l.unitCost);
      return {
        organizationId: orgId,
        itemId: l.itemId,
        warehouseId: args.warehouseId ?? null,
        date: args.date,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId: args.id,
        qtyIn: qtyDiff > 0 ? qtyDiff : 0,
        qtyOut: qtyDiff < 0 ? -qtyDiff : 0,
        unitCost,
        valueChange: asMoney(qtyDiff * unitCost),
      };
    }),
  });

  const netRounded = asMoney(lines.reduce((sum, l) => sum + lineQtyDiff(l) * toNumber(l.unitCost), 0));
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
        { accountId: varianceAccountId, description: `Stock variance - ${args.number}`, debit: 0, credit: netRounded },
      ],
    });
  } else {
    const amount = -netRounded;
    await postJournalEntry(tx, {
      organizationId: orgId,
      date: args.date,
      memo,
      lines: [
        { accountId: varianceAccountId, description: `Stock variance - ${args.number}`, debit: amount, credit: 0 },
        { accountId: inventoryAccountId, description: `Inventory decrease - ${args.number}`, debit: 0, credit: amount },
      ],
    });
  }
}
