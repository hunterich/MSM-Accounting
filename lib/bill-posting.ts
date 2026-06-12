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

  let grirNet = 0;
  let inventoryNet = 0;
  let expenseNet = 0;
  let taxTotal = 0;
  const manualInventoryLines: Array<{ itemId: string; qty: number; unitCost: number }> = [];

  for (const line of lines) {
    const gross = toNumber(line.lineTotal);
    const net = taxInclusive ? asMoney(gross / (1 + rate)) : gross;
    const lineTax = !taxable ? 0 : taxInclusive ? asMoney(gross - net) : asMoney(net * rate);
    taxTotal += lineTax;

    const isInventory = line.itemId != null && inventoryItemIds.has(line.itemId);
    if (isInventory && line.purchaseOrderLineId) {
      grirNet += net;
    } else if (isInventory) {
      inventoryNet += net;
      const qty = toNumber(line.quantity);
      if (qty > 0) manualInventoryLines.push({ itemId: line.itemId as string, qty, unitCost: asMoney(net / qty) });
    } else {
      expenseNet += net;
    }
  }

  grirNet = asMoney(grirNet);
  inventoryNet = asMoney(inventoryNet);
  expenseNet = asMoney(expenseNet);
  taxTotal = asMoney(taxTotal);
  const apTotal = asMoney(grirNet + inventoryNet + expenseNet + taxTotal);

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
  if (expenseNet > 0 && expenseAccountId) {
    journalLines.push({ accountId: expenseAccountId, description: `Expense - ${bill.number}`, debit: expenseNet, credit: 0 });
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
