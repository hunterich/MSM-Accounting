import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { toNumber } from './money';
import { MoneyDecimal } from './money-decimal';
import { calculateBillAmounts } from './bill-totals';
import { ApiError } from './errors';
import { addCostLayer, lockInventoryItems } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { ensureGrIrAccount } from './grir';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { itemPostingAccount } from './item-posting-accounts';

type Tx = Prisma.TransactionClient;

interface ReceiptLine {
  itemId: string | null;
  quantity: unknown;
  lineTotal: unknown;
  taxable?: boolean | null;
  poReceiptTaxAmount?: unknown;
}

interface GoodsReceiptPostingArgs {
  billId: string;
  poNumber: string;
  date: Date;
  taxInclusive: boolean;
  taxRate: Prisma.Decimal.Value; // percent, e.g. 11
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
  const amounts = calculateBillAmounts({ ...args, taxable: args.taxInclusive });

  const itemIds = args.lines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  // Hold the item locks while reading account mappings and posting stock.
  await lockInventoryItems(tx, orgId, itemIds);
  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } },
        select: { id: true, inventoryAccountId: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));
  const itemById = new Map(inventoryItems.map(item => [item.id, item]));

  const zero = new MoneyDecimal(0);
  let grirNet = zero;
  const layers: Array<{ itemId: string; qty: number; unitCost: number; value: Prisma.Decimal }> = [];
  for (const [index, line] of args.lines.entries()) {
    if (!line.itemId || !inventoryItemIds.has(line.itemId)) continue;
    const qty = toNumber(line.quantity);
    if (qty <= 0) continue;
    const net = amounts.lines[index].net;
    grirNet = grirNet.plus(net);
    layers.push({ itemId: line.itemId, qty, unitCost: net.div(qty).toNumber(), value: net });
  }
  if (!layers.length || grirNet.lt(0)) return;

  // Quantity is independent of price. Free receipts still create stock and
  // may settle an estimated shortage (whose COGS journal is posted by the
  // cost-layer service), but require no Inventory/GRIR receipt journal.
  if (grirNet.isZero()) {
    for (const layer of layers) {
      await addCostLayer(tx, orgId, layer.itemId, null, layer.qty, layer.unitCost, InventoryDocumentType.PURCHASE, args.billId, args.date, layer.value, undefined, true);
    }
    return;
  }

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const defaultInventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const inventoryByAccount = new Map<string, Prisma.Decimal>();
  const layerAccounts = layers.map(layer => {
    const accountId = itemPostingAccount(accounts, itemById.get(layer.itemId)?.inventoryAccountId, defaultInventoryAccountId, 'ASSET', 'inventory');
    if (!accountId) throw new ApiError('Cannot receive stock: no Inventory asset account is configured. Set the Inventory default in Settings → Accounts.', 422);
    inventoryByAccount.set(accountId, (inventoryByAccount.get(accountId) ?? zero).plus(layer.value));
    return accountId;
  });
  const grirAccountId = await ensureGrIrAccount(tx, orgId);

  for (const [index, layer] of layers.entries()) {
    await addCostLayer(tx, orgId, layer.itemId, null, layer.qty, layer.unitCost, InventoryDocumentType.PURCHASE, args.billId, args.date, layer.value, layerAccounts[index], true);
  }

  const journal = await postJournalEntry(tx, {
    organizationId: orgId,
    date: args.date,
    memo: `Goods receipt: PO ${args.poNumber}`,
    lines: [
      ...[...inventoryByAccount].map(([accountId, amount]) => ({ accountId, description: `Inventory - PO ${args.poNumber}`, debit: amount, credit: 0 })),
      { accountId: grirAccountId, description: `GR/IR clearing - PO ${args.poNumber}`, debit: 0, credit: grirNet },
    ],
  });
  await tx.bill.update({ where: { id: args.billId, organizationId: orgId }, data: { receiptPostingJournalId: journal.id } });
}
