import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { toNumber, asMoney } from './money';
import { ApiError } from './errors';
import { addCostLayer } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { ensureGrIrAccount } from './grir';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';

type Tx = Prisma.TransactionClient;

interface ReceiptLine {
  itemId: string | null;
  quantity: unknown;
  lineTotal: unknown;
}

interface GoodsReceiptPostingArgs {
  billId: string;
  poNumber: string;
  date: Date;
  taxInclusive: boolean;
  taxRate: number; // percent, e.g. 11
  lines: ReceiptLine[];
}

/**
 * Book inventory + GR/IR clearing for goods received against a PO.
 *
 * For every stocked line: Dr Inventory / Cr GR/IR at NET cost, plus a cost
 * layer. The matching Cr-GR/IR is later cleared by Dr-GR/IR when the bill is
 * finalized (see bill-posting.ts).
 *
 * Fail-loud: if the inventory asset account is not configured, this throws
 * BEFORE writing any cost layer, so the inventory subledger and the GL can
 * never diverge (mirrors the COGS guard on the sales side).
 */
export async function postGoodsReceiptToLedger(
  tx: Tx,
  orgId: string,
  args: GoodsReceiptPostingArgs,
): Promise<void> {
  const rate = args.taxInclusive ? toNumber(args.taxRate) / 100 : 0;

  const itemIds = args.lines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } },
        select: { id: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

  let grirNet = 0;
  const layers: Array<{ itemId: string; qty: number; unitCost: number }> = [];
  for (const line of args.lines) {
    if (!line.itemId || !inventoryItemIds.has(line.itemId)) continue;
    const qty = toNumber(line.quantity);
    if (qty <= 0) continue;
    const gross = toNumber(line.lineTotal);
    const net = args.taxInclusive ? asMoney(gross / (1 + rate)) : gross;
    grirNet += net;
    layers.push({ itemId: line.itemId, qty, unitCost: asMoney(net / qty) });
  }
  grirNet = asMoney(grirNet);
  if (grirNet <= 0) return;

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  if (!inventoryAccountId) {
    throw new ApiError(
      'Cannot receive stock: no Inventory asset account is configured. Set the Inventory default in Settings → Accounts.',
      422,
    );
  }
  const grirAccountId = await ensureGrIrAccount(tx, orgId);

  for (const layer of layers) {
    await addCostLayer(tx, orgId, layer.itemId, null, layer.qty, layer.unitCost, InventoryDocumentType.PURCHASE, args.billId, args.date);
  }

  await postJournalEntry(tx, {
    organizationId: orgId,
    date: args.date,
    memo: `Goods receipt: PO ${args.poNumber}`,
    lines: [
      { accountId: inventoryAccountId, description: `Inventory - PO ${args.poNumber}`, debit: grirNet, credit: 0 },
      { accountId: grirAccountId, description: `GR/IR clearing - PO ${args.poNumber}`, debit: 0, credit: grirNet },
    ],
  });
}
