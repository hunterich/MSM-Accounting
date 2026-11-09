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
import { calculateAndPostCOGS, lockInventoryItems } from './inventory-costing';
import { asMoney, toNumber } from './money';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import type { TransactionDateGuardOptions } from './transaction-date-policy';

type Tx = Prisma.TransactionClient;

export async function postPurchaseReturnOnApproval(
  tx: Tx,
  purchaseReturnId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const pr = await tx.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    include: { lines: true },
  });
  if (!pr || pr.journalEntryId) return;

  // Refuse to post inventory/GL into a closed/locked accounting period.
  await assertPeriodOpen(tx, pr.organizationId, pr.returnDate, opts);

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
  // Match invoice posting/corrections: acquire all shared stock locks in one
  // global order before consuming any line, regardless of document line order.
  await lockInventoryItems(tx, pr.organizationId, [...inventoryItemIds]);

  let totalConsumedCost = 0;
  const inventoryByAccount = new Map<string, number>();
  for (const line of pr.lines) {
    const qty = toNumber(line.qtyReturn);
    if (qty <= 0 || !line.itemId || !inventoryItemIds.has(line.itemId)) continue;
    // A return removes stock already on the books. Do not infer its account
    // from today's item settings or company defaults. Refuse an ambiguous pool.
    const lots = await tx.inventoryLot.findMany({
      where: { organizationId: pr.organizationId, itemId: line.itemId, warehouseId: pr.warehouseId ?? null, qtyBalance: { gt: 0 } },
      include: { inboundLedgerEntry: { select: { inventoryPostingAccountId: true } } },
    });
    const recorded = new Set(lots.map(lot => lot.inboundLedgerEntry?.inventoryPostingAccountId).filter((id): id is string => Boolean(id)));
    const missing = lots.some(lot => !lot.inboundLedgerEntry?.inventoryPostingAccountId);
    if (recorded.size > 1) throw new ApiError('Stock spans multiple recorded inventory accounts. Review its account history before posting this return.', 422);
    const inventoryAccountId = [...recorded][0] ?? null;
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
      { inventoryPostingAccountId: inventoryAccountId },
    );
    if (cost > 0 && (missing || !inventoryAccountId)) throw new ApiError('Original stock account history is unavailable. Review the historical stock before posting this return.', 422);
    if (cost > 0 && inventoryAccountId) inventoryByAccount.set(inventoryAccountId, asMoney((inventoryByAccount.get(inventoryAccountId) ?? 0) + cost));
    totalConsumedCost = asMoney(totalConsumedCost + cost);
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
  const apReturnAccountId =
    pr.returnAccountId ?? resolveAccountDefaultId(accounts, settings, 'apReturn');

  if (!apReturnAccountId) {
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
      ...[...inventoryByAccount].map(([accountId, amount]) => ({
        accountId,
        description: `Inventory removal - ${pr.number}`,
        debit: 0,
        credit: amount,
      })),
    ],
  });

  await tx.purchaseReturn.update({
    where: { id: pr.id },
    data: { journalEntryId: je.id, postedAt: new Date() },
  });
}
