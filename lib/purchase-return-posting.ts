/**
 * GL + inventory posting for PurchaseReturn approval.
 *
 * Design (per locked plan, Option B, with refinement noted in implementation):
 *   - PurchaseReturn handles the inventory side: consumes FIFO/WA layers to
 *     remove returned stock and posts DR apReturn / CR Inventory at the
 *     total consumed cost.
 *   - The linked DebitNote (when issued) handles the AP-side reversal
 *     (DR apControl / CR apReturn) — already implemented elsewhere. The
 *     apReturn account thus acts as a clearing line: debited here, credited
 *     by the DebitNote, netting to zero when both documents settle.
 *   - If `consumeFIFO totalCost` differs from `subtotal`, the variance lives
 *     temporarily in the apReturn balance and is settled by the DN amount
 *     (which uses the agreed return price). Tax handling is out of scope
 *     here (item #3, separate PR).
 *
 * Idempotent: short-circuits when purchaseReturn.journalEntryId is already set.
 */
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { calculateAndPostCOGS } from './inventory-costing';
import { toNumber } from './money';

type Tx = Prisma.TransactionClient;

export async function postPurchaseReturnOnApproval(
  tx: Tx,
  purchaseReturnId: string,
): Promise<void> {
  const pr = await tx.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    include: { lines: true },
  });
  if (!pr || pr.journalEntryId) return;

  const itemIds = pr.lines
    .map((l) => l.itemId)
    .filter((x): x is string => Boolean(x));

  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: {
          id: { in: itemIds },
          organizationId: pr.organizationId,
          type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
        },
        select: { id: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

  let totalConsumedCost = 0;
  for (const line of pr.lines) {
    const qty = toNumber(line.qtyReturn);
    if (qty <= 0 || !line.itemId || !inventoryItemIds.has(line.itemId)) continue;
    // calculateAndPostCOGS performs FIFO/WA consumption + writes the outbound
    // InventoryLedgerEntry. It does NOT post a JournalEntry — we do that
    // ourselves below for the GL leg.
    const cost = await calculateAndPostCOGS(
      tx,
      pr.organizationId,
      line.itemId,
      pr.warehouseId ?? null,
      qty,
      InventoryDocumentType.PURCHASE_RETURN,
      pr.id,
      pr.returnDate,
    );
    totalConsumedCost += cost;
  }

  if (totalConsumedCost <= 0) {
    // Services-only return, or no inventory items. Mark posted; DN handles
    // the financial side independently.
    await tx.purchaseReturn.update({
      where: { id: pr.id },
      data: { postedAt: new Date() },
    });
    return;
  }

  const accounts = await tx.account.findMany({
    where: { organizationId: pr.organizationId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, pr.organizationId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const apReturnAccountId =
    pr.returnAccountId ?? resolveAccountDefaultId(accounts, settings, 'apReturn');

  if (!inventoryAccountId || !apReturnAccountId) {
    throw new Error(
      `PurchaseReturn ${pr.number}: missing inventoryAsset/apReturn account defaults`,
    );
  }

  const je = await postJournalEntry(tx, {
    organizationId: pr.organizationId,
    date: pr.returnDate,
    memo: `Purchase return inventory: ${pr.number}`,
    lines: [
      {
        accountId: apReturnAccountId,
        description: `Purchase return clearing - ${pr.number}`,
        debit: totalConsumedCost,
        credit: 0,
      },
      {
        accountId: inventoryAccountId,
        description: `Inventory removal - ${pr.number}`,
        debit: 0,
        credit: totalConsumedCost,
      },
    ],
  });

  await tx.purchaseReturn.update({
    where: { id: pr.id },
    data: { journalEntryId: je.id, postedAt: new Date() },
  });
}
