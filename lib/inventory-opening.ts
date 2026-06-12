/**
 * Opening-stock posting.
 *
 * Historically `Item.openingStock` was a flat number that created no cost layer
 * and no journal entry — so on-hand quantity (summed from `InventoryLot`) and
 * openingStock disagreed, and opening inventory never reached the balance
 * sheet. This helper turns opening stock into real, reconcilable accounting:
 *
 *   - writes an OPENING `InventoryLot` (+ perpetual ledger entry) via `addCostLayer`
 *   - posts the opening journal entry:
 *       DR Inventory Asset        qty × costPrice
 *       CR Opening Balance Equity qty × costPrice
 *
 * It is idempotent: once an OPENING ledger entry exists for the item, calling
 * again is a no-op. That makes it safe to invoke from item create, item update,
 * and the one-time backfill script.
 */
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { ApiError } from './errors';
import { toNumber, asMoney } from './money';

type Tx = Prisma.TransactionClient;

const STOCKED_TYPES = new Set(['PRODUCT', 'RAW_MATERIAL']);

export async function postOpeningStockIfNeeded(
  tx: Tx,
  orgId: string,
  itemId: string,
  date: Date = new Date(),
): Promise<void> {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      sku: true,
      type: true,
      openingStock: true,
      costPrice: true,
      inventoryAccountId: true,
    },
  });
  if (!item) return;

  // Only stocked item types carry inventory value.
  if (!STOCKED_TYPES.has(item.type)) return;

  const qty = toNumber(item.openingStock);
  if (qty <= 0) return;

  // Idempotency: never double-post opening stock.
  const existing = await tx.inventoryLedgerEntry.findFirst({
    where: { organizationId: orgId, itemId, documentType: InventoryDocumentType.OPENING },
    select: { id: true },
  });
  if (existing) return;

  const unitCost = toNumber(item.costPrice);

  // Always write the cost layer + perpetual ledger so on-hand quantity is
  // correct even for zero-cost items.
  await addCostLayer(tx, orgId, itemId, null, qty, unitCost, InventoryDocumentType.OPENING, item.id, date);

  // Only post a journal entry when the opening stock carries value.
  const value = asMoney(qty * unitCost);
  if (value <= 0) return;

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId =
    item.inventoryAccountId || resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const equityAccountId = resolveAccountDefaultId(accounts, settings, 'openingBalanceEquity');

  if (!inventoryAccountId || !equityAccountId) {
    throw new ApiError(
      `Cannot post opening stock for ${item.sku}: configure Inventory Asset and ` +
        `Opening Balance Equity accounts in Settings before setting opening stock.`,
      422,
    );
  }

  await postJournalEntry(tx, {
    organizationId: orgId,
    date,
    memo: `Opening stock: ${item.sku}`,
    lines: [
      { accountId: inventoryAccountId, description: `Opening inventory - ${item.sku}`, debit: value, credit: 0 },
      { accountId: equityAccountId, description: `Opening balance equity - ${item.sku}`, debit: 0, credit: value },
    ],
  });
}
