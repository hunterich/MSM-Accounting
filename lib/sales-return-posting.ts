/**
 * GL + inventory posting for SalesReturn approval.
 *
 * Design (per locked plan, Option B):
 *   - SalesReturn handles ONLY the inventory side: DR Inventory / CR COGS at
 *     the restock value.
 *   - The linked CreditNote (when issued) handles the financial side
 *     (DR arReturn / CR arControl) — already implemented elsewhere.
 *   - Tax reversal is out of scope here (item #3, separate PR).
 *
 * Cost basis: current weighted-average via getWeightedAverageCost().
 * SalesInvoiceLine has no `unitCost` column, so the originally-consumed FIFO
 * cost cannot be recovered without a schema migration. Using current WA cost
 * is a documented simplification.
 *
 * Idempotent: short-circuits when salesReturn.journalEntryId is already set.
 */
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { addCostLayer, getWeightedAverageCost } from './inventory-costing';
import { toNumber, asMoney } from './money';
import { assertPeriodOpen } from './period-guard';
import type { TransactionDateGuardOptions } from './transaction-date-policy';

type Tx = Prisma.TransactionClient;

export async function postSalesReturnOnApproval(
  tx: Tx,
  salesReturnId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const sr = await tx.salesReturn.findUnique({
    where: { id: salesReturnId },
    include: { lines: true },
  });
  if (!sr || sr.journalEntryId) return;

  // Refuse to post inventory/GL into a closed/locked accounting period.
  await assertPeriodOpen(tx, sr.organizationId, sr.returnDate, opts);

  const itemIds = sr.lines
    .map((l) => l.itemId)
    .filter((x): x is string => Boolean(x));

  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: {
          id: { in: itemIds },
          organizationId: sr.organizationId,
          type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
        },
        select: { id: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

  let totalRestockValue = 0;
  for (const line of sr.lines) {
    const qty = toNumber(line.qtyReturn);
    if (qty <= 0 || !line.itemId || !inventoryItemIds.has(line.itemId)) continue;
    const waCost = await getWeightedAverageCost(
      tx,
      sr.organizationId,
      line.itemId,
      sr.warehouseId ?? null,
    );
    if (waCost <= 0) continue;
    await addCostLayer(
      tx,
      sr.organizationId,
      line.itemId,
      sr.warehouseId ?? null,
      qty,
      waCost,
      InventoryDocumentType.SALES_RETURN,
      sr.id,
      sr.returnDate,
    );
    totalRestockValue += asMoney(qty * waCost);
  }

  if (totalRestockValue <= 0) {
    // Services-only return, or no inventory items, or zero WA cost everywhere.
    // Mark posted but skip JE — nothing to debit/credit.
    await tx.salesReturn.update({
      where: { id: sr.id },
      data: { postedAt: new Date() },
    });
    return;
  }

  const accounts = await tx.account.findMany({
    where: { organizationId: sr.organizationId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, sr.organizationId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const cogsAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');

  if (!inventoryAccountId || !cogsAccountId) {
    throw new Error(
      `SalesReturn ${sr.number}: missing inventoryAsset/cogsExpense account defaults`,
    );
  }

  const je = await postJournalEntry(tx, {
    organizationId: sr.organizationId,
    date: sr.returnDate,
    memo: `Sales return inventory: ${sr.number}`,
    lines: [
      {
        accountId: inventoryAccountId,
        description: `Inventory restock - ${sr.number}`,
        debit: totalRestockValue,
        credit: 0,
      },
      {
        accountId: cogsAccountId,
        description: `COGS reversal - ${sr.number}`,
        debit: 0,
        credit: totalRestockValue,
      },
    ],
  });

  await tx.salesReturn.update({
    where: { id: sr.id },
    data: { journalEntryId: je.id, postedAt: new Date() },
  });
}
