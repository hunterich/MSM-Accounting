import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { toNumber, asMoney } from './money';
import { addCostLayer } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { ensureGrIrAccount } from './grir';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';

type Tx = Prisma.TransactionClient;

interface PostableBillLine {
  id: string;
  itemId: string | null;
  accountId?: string | null;
  quantity: unknown;
  price: unknown;
  lineTotal: unknown;
  purchaseOrderLineId: string | null;
}
interface PostableBill {
  id: string;
  number: string;
  issueDate: Date | string | null;
  apAccountId: string | null;
  taxable: boolean;
  taxInclusive: boolean;
  taxRate: unknown;
  lines: PostableBillLine[];
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
  if (lines.length === 0) return;

  const itemIds = lines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } },
        select: { id: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

  // If goods were already received against this bill (cost layers booked at
  // receipt), inventory is already on the books — every stocked line must clear
  // GR/IR, never re-book inventory, even if the per-line PO link was dropped on
  // an edit (the frontend can omit purchaseOrderLineId). Guards against a
  // double-count of inventory and a stranded GR/IR balance.
  const receiptAlreadyBooked =
    (await tx.inventoryLot.count({
      where: { organizationId: orgId, documentType: InventoryDocumentType.PURCHASE, documentId: bill.id },
    })) > 0;

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const apAccountId = bill.apAccountId ?? resolveAccountDefaultId(accounts, settings, 'apControl');
  const inputTaxAccountId = resolveAccountDefaultId(accounts, settings, 'apTax');
  const expenseAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');

  const taxable = Boolean(bill.taxable);
  const taxInclusive = Boolean(bill.taxInclusive);
  const rate = taxable ? toNumber(bill.taxRate) / 100 : 0;
  const billDate = bill.issueDate ? new Date(bill.issueDate) : new Date();

  // Postable accounts the user may code a line to directly (active + postable).
  const postableById = new Map(accounts.filter((a) => a.isPostable).map((a) => [a.id, a]));

  let grirNet = 0;
  let inventoryNet = 0;
  let taxTotal = 0;
  // Non-inventory lines are debited to the account chosen on the line
  // (expense, prepaid, fixed asset, …). Lines that carry no/invalid account
  // fall back to the org's cogsExpense default. Keyed by accountId so multiple
  // lines hitting the same account collapse into one balanced debit.
  const expenseByAccount = new Map<string, number>();
  const manualInventoryLines: Array<{ itemId: string; qty: number; unitCost: number }> = [];

  for (const line of lines) {
    const gross = toNumber(line.lineTotal);
    const net = taxInclusive ? asMoney(gross / (1 + rate)) : gross;
    const lineTax = !taxable ? 0 : taxInclusive ? asMoney(gross - net) : asMoney(net * rate);
    taxTotal += lineTax;

    const isInventory = line.itemId != null && inventoryItemIds.has(line.itemId);
    if (isInventory && (line.purchaseOrderLineId || receiptAlreadyBooked)) {
      grirNet += net;
    } else if (isInventory) {
      inventoryNet += net;
      const qty = toNumber(line.quantity);
      if (qty > 0) manualInventoryLines.push({ itemId: line.itemId as string, qty, unitCost: asMoney(net / qty) });
    } else {
      const codedId = line.accountId && postableById.has(line.accountId) ? line.accountId : expenseAccountId;
      if (codedId) expenseByAccount.set(codedId, (expenseByAccount.get(codedId) ?? 0) + net);
    }
  }

  grirNet = asMoney(grirNet);
  inventoryNet = asMoney(inventoryNet);
  taxTotal = asMoney(taxTotal);
  let expenseTotal = 0;
  for (const [accountId, amount] of expenseByAccount) {
    const rounded = asMoney(amount);
    expenseByAccount.set(accountId, rounded);
    expenseTotal += rounded;
  }
  expenseTotal = asMoney(expenseTotal);
  const apTotal = asMoney(grirNet + inventoryNet + expenseTotal + taxTotal);

  for (const m of manualInventoryLines) {
    await addCostLayer(tx, orgId, m.itemId, null, m.qty, m.unitCost, InventoryDocumentType.PURCHASE, bill.id, billDate);
  }

  const journalLines: Array<{ accountId: string; description: string; debit: number; credit: number }> = [];
  if (grirNet > 0) {
    const grirAccountId = await ensureGrIrAccount(tx, orgId);
    journalLines.push({ accountId: grirAccountId, description: `GR/IR clearing - ${bill.number}`, debit: grirNet, credit: 0 });
  }
  if (inventoryNet > 0 && inventoryAccountId) {
    journalLines.push({ accountId: inventoryAccountId, description: `Inventory - ${bill.number}`, debit: inventoryNet, credit: 0 });
  }
  for (const [accountId, amount] of expenseByAccount) {
    if (amount > 0) {
      journalLines.push({ accountId, description: `Expense - ${bill.number}`, debit: amount, credit: 0 });
    }
  }
  if (taxTotal > 0 && inputTaxAccountId) {
    journalLines.push({ accountId: inputTaxAccountId, description: `Input tax - ${bill.number}`, debit: taxTotal, credit: 0 });
  }
  if (apTotal > 0 && apAccountId) {
    journalLines.push({ accountId: apAccountId, description: `AP - ${bill.number}`, debit: 0, credit: apTotal });
  }

  const hasDebit = journalLines.some((l) => l.debit > 0);
  const hasCredit = journalLines.some((l) => l.credit > 0);
  if (hasDebit && hasCredit) {
    await postJournalEntry(tx, { organizationId: orgId, date: billDate, memo: `Bill: ${bill.number}`, lines: journalLines });
  }
}
