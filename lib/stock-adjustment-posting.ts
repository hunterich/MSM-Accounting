import type { Prisma } from '@prisma/client';
import { assertDocumentOffsetAccounts } from './document-offset-accounts';
import { InventoryDocumentType } from '@prisma/client';
import { asMoney, toNumber } from './money';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { addCostLayer, relieveCostLayers, lockInventoryItems } from './inventory-costing';
import { assertPeriodOpen } from './period-guard';
import type { TransactionDateGuardOptions } from './transaction-date-policy';
import { itemPostingAccount, lotsWithBookValue } from './item-posting-accounts';
import { ApiError } from './errors';

type Tx = Prisma.TransactionClient;

export interface StockAdjustmentPostingLine {
  accountId?: string | null;
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
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const lines = args.lines ?? [];
  if (lines.length === 0) return;
  await assertDocumentOffsetAccounts(tx, orgId, lines.map(line => line.accountId));

  // Refuse to move inventory/GL into a closed/locked accounting period. This
  // single guard covers every forward stock-adjustment posting path: direct
  // create-as-APPROVED, the approval finalizer, and stock-count posting (which
  // routes through here). The void path guards separately.
  await assertPeriodOpen(tx, orgId, args.date, opts);
  // Hold every affected item in the same order as sales/returns before reading
  // cost layers or taking the journal-number lock, including increase-only lines.
  await lockInventoryItems(tx, orgId, lines.map(line => line.itemId));

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const defaultInventory = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const varianceAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') || resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  const items = await tx.item.findMany({ where: { organizationId: orgId, id: { in: lines.map(line => line.itemId) } }, select: { id: true, inventoryAccountId: true } });
  const itemById = new Map(items.map(item => [item.id, item]));
  const valuesByAccount = new Map<string, number>();
  let netValue = 0;
  for (const l of lines) {
    const qtyDiff = lineQtyDiff(l);
    const item = itemById.get(l.itemId);
    if (!item) throw new ApiError('Stock adjustment item was not found in this company.', 422);
    const configuredAccount = itemPostingAccount(accounts, item.inventoryAccountId, defaultInventory, 'ASSET', 'inventory');
    if (qtyDiff > 0) {
      const unitCost = toNumber(l.unitCost);
      const value = asMoney(qtyDiff * unitCost);
      if (value !== 0 && !configuredAccount) throw new ApiError('No inventory account is configured for this item.', 422);
      await addCostLayer(
        tx, orgId, l.itemId, args.warehouseId ?? null,
        qtyDiff, unitCost, InventoryDocumentType.ADJUSTMENT, args.id, args.date,
        undefined, value !== 0 ? configuredAccount : undefined,
      );
      if (configuredAccount) valuesByAccount.set(configuredAccount, asMoney((valuesByAccount.get(configuredAccount) ?? 0) + value));
      netValue += value;
    } else if (qtyDiff < 0) {
      const lots = await tx.inventoryLot.findMany({ where: { organizationId: orgId, itemId: l.itemId, warehouseId: args.warehouseId ?? null, qtyBalance: { gt: 0 } }, include: { inboundLedgerEntry: { select: { inventoryPostingAccountId: true } } } });
      const valuedLots = lotsWithBookValue(lots);
      const recorded = new Set(valuedLots.map(lot => lot.inboundLedgerEntry?.inventoryPostingAccountId).filter((id): id is string => Boolean(id)));
      if (recorded.size > 1) throw new ApiError('Stock spans multiple recorded inventory accounts. Review its account history before adjusting it.', 422);
      const inventoryAccountId = [...recorded][0] ?? configuredAccount;
      const cost = await relieveCostLayers(
        tx, orgId, l.itemId, args.warehouseId ?? null,
        -qtyDiff, InventoryDocumentType.ADJUSTMENT, args.id, args.date,
        inventoryAccountId,
      );
      if (cost > 0 && (!inventoryAccountId || valuedLots.some(lot => !lot.inboundLedgerEntry?.inventoryPostingAccountId))) throw new ApiError('Original stock account history is unavailable. Review the historical stock before adjusting it.', 422);
      if (inventoryAccountId) valuesByAccount.set(inventoryAccountId, asMoney((valuesByAccount.get(inventoryAccountId) ?? 0) - cost));
      netValue -= cost;
    }
    // qtyDiff === 0 → no movement
  }

  const netRounded = asMoney(netValue);
  const inventoryLines = [...valuesByAccount].filter(([, value]) => value !== 0);
  if (inventoryLines.length === 0) return;
  if (netRounded !== 0 && !varianceAccountId) throw new ApiError('No stock variance account is configured.', 422);
  await assertDocumentOffsetAccounts(tx, orgId, [...inventoryLines.map(([id]) => id), varianceAccountId]);

  const memo = `Stock adjustment: ${args.number}`;
  const journalLines = inventoryLines.map(([accountId, value]) => ({ accountId, description: `Inventory ${value > 0 ? 'increase' : 'decrease'} - ${args.number}`, debit: Math.max(value, 0), credit: Math.max(-value, 0) }));
  const variance = netRounded !== 0 ? [{ accountId: varianceAccountId!, description: `Stock variance - ${args.number}`, debit: Math.max(-netRounded, 0), credit: Math.max(netRounded, 0) }] : [];
  await postJournalEntry(tx, { organizationId: orgId, date: args.date, memo, lines: netRounded < 0 ? [...variance, ...journalLines] : [...journalLines, ...variance] });
}

/**
 * Fetch a stock adjustment + its lines by id and post them to the ledger.
 * Used by the approval finalizer (which only has the document id). Skips when
 * the adjustment is already APPROVED (i.e. already posted) or missing.
 *
 * Idempotency note: unlike payments (which carry a journalEntryId token),
 * StockAdjustment has no posted-token, so re-entry is guarded solely by the
 * `status === 'APPROVED'` check below. This is safe because the approval
 * engine's PENDING-request guard ensures the finalizer runs exactly once. A
 * future caller that invoked this while status is still PENDING_APPROVAL
 * (before the finalizer flips it to APPROVED) would double-post.
 */
export async function postStockAdjustmentIfNeeded(
  tx: Tx,
  orgId: string,
  adjustmentId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const adj = await tx.stockAdjustment.findFirst({
    where: { id: adjustmentId, organizationId: orgId },
    include: { lines: true },
  });
  if (!adj || adj.status === 'APPROVED') return; // already posted / nothing to do
  await postStockAdjustmentToLedger(tx, orgId, {
    id: adj.id,
    number: adj.number,
    date: adj.date,
    warehouseId: adj.warehouseId,
    lines: adj.lines.map((l) => ({
      accountId: l.accountId,
      itemId: l.itemId,
      oldQty: l.oldQty,
      newQty: l.newQty,
      qtyDiff: l.qtyDiff,
      unitCost: l.unitCost,
    })),
  }, opts);
}
