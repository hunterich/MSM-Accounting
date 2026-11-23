import type { Prisma } from '@prisma/client';
import { assertDocumentOffsetAccounts } from './document-offset-accounts';
import { InventoryDocumentType } from '@prisma/client';
import { toNumber } from './money';
import { MoneyDecimal } from './money-decimal';
import { calculateBillAmounts } from './bill-totals';
import { addCostLayer, lockInventoryItems } from './inventory-costing';
import { postJournalEntry, type JournalLineInput } from './journal-posting';
import { ensureGrIrAccount } from './grir';
import { ensurePphPayableAccount } from './withholding';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { ApiError } from './errors';
import { itemPostingAccount } from './item-posting-accounts';

type Tx = Prisma.TransactionClient;

interface PostableBillLine {
  id: string;
  itemId: string | null;
  accountId?: string | null;
  assetId?: string | null;
  quantity: unknown;
  price: unknown;
  lineTotal: unknown;
  taxable?: boolean | null;
  poReceiptTaxAmount?: unknown;
  purchaseOrderLineId: string | null;
}
interface PostableBillCharge {
  label?: string | null;
  accountId?: string | null;
  amount: unknown;
  taxRate?: unknown;
}
interface PostableBill {
  id: string;
  number: string;
  issueDate: Date | string | null;
  apAccountId: string | null;
  taxable: boolean;
  taxInclusive: boolean;
  taxRate: unknown;
  /** PPh withholding rate (%) on the pre-tax net; 0/absent → no withholding. */
  withholdingRate?: unknown;
  totalAmount?: unknown;
  lines: PostableBillLine[];
  /** additional costs (freight/insurance/handling); each posts to its own account. */
  charges?: PostableBillCharge[];
}

/**
 * Post inventory cost layers + one balanced journal entry for a bill.
 *
 * Per-line rules:
 *   - inventory line WITH purchaseOrderLineId -> Dr GR/IR, no cost layer
 *     (inventory was already recognized at goods receipt)
 *   - inventory line WITHOUT PO link -> Dr Inventory + cost layer
 *   - service / non-inventory line -> Dr Expense
 * Plus Dr Input Tax (when taxable) and Cr AP (the balancing credit).
 * All inventory/GR/IR/expense debits use NET line value; AP credit is the
 * sum of debits so the entry always balances.
 */
export async function postBillToLedger(tx: Tx, orgId: string, bill: PostableBill): Promise<void> {
  const lines = bill.lines ?? [];
  await assertDocumentOffsetAccounts(tx, orgId, [...lines, ...(bill.charges ?? [])].map(line => line.accountId));
  const amounts = calculateBillAmounts({ ...bill, lines });
  const { taxAmount, withholdingAmount, totalAmount } = amounts;
  if (bill.totalAmount != null && !totalAmount.eq(String(bill.totalAmount))) {
    throw new ApiError(`Bill ${bill.number} has a saved payable of ${bill.totalAmount} but its lines and tax calculate to ${totalAmount.toFixed(2)}. Review and save the bill before posting.`, 422);
  }
  if (!lines.length && !bill.charges?.length) return;
  for (const [index, line] of lines.entries()) {
    if (!line.assetId) continue;
    const asset = await tx.asset.findFirst({ where: { id: line.assetId!, organizationId: orgId, deletedAt: null }, include: { category: true, purchaseLine: true } });
    const account = asset?.category.assetAccountId ? await tx.account.findFirst({ where: { id: asset.category.assetAccountId, organizationId: orgId, isActive: true, isPostable: true } }) : null;
    const net = amounts.lines[index].net;
    if (!asset || asset.status !== 'DRAFT' || asset.purchaseLine?.billId !== bill.id || line.itemId || line.purchaseOrderLineId || Number(line.quantity) !== 1 || !account || !['ASSET', 'Asset'].includes(account.type) || line.accountId !== account.id || !net.eq(String(asset.acquisitionCost))) {
      throw new ApiError('Asset purchase link, category account, or cost has changed. Review the draft bill before posting.', 422);
    }
  }

  const itemIds = lines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  // If goods were already received against this bill (cost layers booked at
  // receipt), inventory is already on the books — every stocked line must clear
  // GR/IR, never re-book inventory, even if the per-line PO link was dropped on
  // an edit (the frontend can omit purchaseOrderLineId). Guards against a
  // double-count of inventory and a stranded GR/IR balance.
  const legacyReceiptWithoutLinks = !lines.some(line => line.poReceiptTaxAmount != null) &&
    (await tx.inventoryLot.count({
      where: { organizationId: orgId, documentType: InventoryDocumentType.PURCHASE, documentId: bill.id },
    })) > 0;

  // Lock before reading the mapping so an account change cannot race posting.
  const directItemIds = legacyReceiptWithoutLinks ? [] : lines.filter(l => l.itemId && !l.purchaseOrderLineId).map(l => l.itemId!);
  if (directItemIds.length) await lockInventoryItems(tx, orgId, directItemIds);
  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } },
        select: { id: true, inventoryAccountId: true },
      })
    : [];
  const inventoryItemById = new Map(inventoryItems.map(i => [i.id, i]));
  const inventoryItemIds = new Set(inventoryItems.map(i => i.id));

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const apAccountId = bill.apAccountId ?? resolveAccountDefaultId(accounts, settings, 'apControl');
  const inputTaxAccountId = resolveAccountDefaultId(accounts, settings, 'apTax');
  const expenseAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');

  const billDate = bill.issueDate ? new Date(bill.issueDate) : new Date();

  // Postable accounts the user may code a line to directly (active + postable).
  const postableById = new Map(accounts.filter((a) => a.isPostable).map((a) => [a.id, a]));

  const zero = new MoneyDecimal(0);
  let grirNet = zero;
  // Non-inventory lines are debited to the account chosen on the line
  // (expense, prepaid, fixed asset, …). Lines that carry no/invalid account
  // fall back to the org's cogsExpense default. Keyed by accountId so multiple
  // lines hitting the same account collapse into one balanced debit.
  const expenseByAccount = new Map<string, Prisma.Decimal>();
  const inventoryByAccount = new Map<string, Prisma.Decimal>();
  function addAmount(map: Map<string, Prisma.Decimal>, accountId: string | null, amount: Prisma.Decimal) {
    if (amount.isZero()) return;
    if (!accountId) throw new ApiError('Configure an account for every bill line and charge before posting.', 422);
    map.set(accountId, (map.get(accountId) ?? zero).plus(amount));
  }
  const manualInventoryLines: Array<{ itemId: string; qty: number; unitCost: number; value: number; accountId: string | null }> = [];

  for (const [index, line] of lines.entries()) {
    const { net } = amounts.lines[index];

    const isInventory = line.itemId != null && inventoryItemIds.has(line.itemId);
    if (isInventory && (line.purchaseOrderLineId || legacyReceiptWithoutLinks)) {
      grirNet = grirNet.plus(net);
    } else if (isInventory) {
      const accountId = itemPostingAccount(accounts, inventoryItemById.get(line.itemId!)?.inventoryAccountId, inventoryAccountId, 'ASSET', 'inventory');
      if (net.gt(0) && !accountId) throw new ApiError('No inventory account is configured for this item.', 422);
      addAmount(inventoryByAccount, accountId, net);
      const qty = toNumber(line.quantity);
      if (qty > 0) manualInventoryLines.push({ itemId: line.itemId as string, qty, unitCost: net.div(qty).toNumber(), value: net.toNumber(), accountId });
    } else {
      const codedId = line.accountId && postableById.has(line.accountId) ? line.accountId : expenseAccountId;
      addAmount(expenseByAccount, codedId, net);
    }
  }

  const chargesByAccount = new Map<string, Prisma.Decimal>();
  for (const [index, charge] of (bill.charges ?? []).entries()) {
    const codedId = charge.accountId && postableById.has(charge.accountId) ? charge.accountId : expenseAccountId;
    addAmount(chargesByAccount, codedId, amounts.charges[index].net);
  }
  if (taxAmount.gt(0) && !inputTaxAccountId) throw new ApiError('Configure an input tax account before posting a taxable bill.', 422);
  if (totalAmount.gt(0) && !apAccountId) throw new ApiError('Configure an accounts payable account before posting the bill.', 422);

  // GR/IR-only bills never change stock. In particular, a PO re-post may
  // already hold journal numbering: it must not acquire unrelated item locks.
  for (const m of manualInventoryLines) {
    await addCostLayer(tx, orgId, m.itemId, null, m.qty, m.unitCost, InventoryDocumentType.PURCHASE, bill.id, billDate, m.value, m.value > 0 ? m.accountId : undefined);
  }

  const journalLines: JournalLineInput<Prisma.Decimal.Value>[] = [];
  if (grirNet.gt(0)) {
    const grirAccountId = await ensureGrIrAccount(tx, orgId);
    journalLines.push({ accountId: grirAccountId, description: `GR/IR clearing - ${bill.number}`, debit: grirNet, credit: 0 });
  }
  for (const [accountId, amount] of inventoryByAccount) {
    if (amount.gt(0)) journalLines.push({ accountId, description: `Inventory - ${bill.number}`, debit: amount, credit: 0 });
  }
  for (const [accountId, amount] of expenseByAccount) {
    if (amount.gt(0)) {
      const label = lines.some(l => l.assetId && l.accountId === accountId) ? 'Asset purchase' : 'Expense';
      journalLines.push({ accountId, description: `${label} - ${bill.number}`, debit: amount, credit: 0 });
    }
  }
  for (const [accountId, amount] of chargesByAccount) {
    if (amount.gt(0)) {
      journalLines.push({ accountId, description: `Additional cost - ${bill.number}`, debit: amount, credit: 0 });
    }
  }
  if (taxAmount.gt(0)) {
    journalLines.push({ accountId: inputTaxAccountId, description: `Input tax - ${bill.number}`, debit: taxAmount, credit: 0 });
  }
  if (withholdingAmount.gt(0)) {
    const pphAccountId = await ensurePphPayableAccount(tx, orgId);
    journalLines.push({ accountId: pphAccountId, description: `PPh withholding - ${bill.number}`, debit: 0, credit: withholdingAmount });
  }
  // Validate actual resolved offsets too: omitted accounts use configurable defaults.
  await assertDocumentOffsetAccounts(tx, orgId, journalLines.map(line => line.accountId));
  if (totalAmount.gt(0)) {
    journalLines.push({ accountId: apAccountId, description: `AP - ${bill.number}`, debit: 0, credit: totalAmount });
  }

  if (journalLines.length) {
    const je = await postJournalEntry(tx, { organizationId: orgId, date: billDate, memo: `Bill: ${bill.number}`, lines: journalLines });
    // Remember the posting entry so the bill can be voided (reversed) later.
    await tx.bill.update({ where: { id: bill.id }, data: { journalEntryId: je.id } });
  }
}
