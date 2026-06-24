/**
 * GL posting for direct bank EXPENSE transactions (Accurate's "Pembayaran").
 *
 * A direct expense pays a cost straight out of a bank/cash account, with no
 * supplier invoice / AP involved:  Dr Expense  /  [Dr Input Tax]  /  Cr Bank.
 *
 * Only EXPENSE transactions post. `journalEntryId` is the idempotency token —
 * set in the same transaction as the journal entry, so re-running is a no-op.
 * INCOME / TRANSFER are intentionally not posted yet (see plan follow-ups).
 *
 * Tax convention matches the entry form: `amount` is the pre-tax BASE and PPN
 * is added on top, so the bank is credited base + tax. Tax types other than
 * PPN (GST / withholding) don't add a VAT leg here.
 */
import type { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import {
  resolveAccountDefaultId,
  resolveBankLinkedAssetAccountId,
  loadOrgAccountDefaults,
} from './account-defaults';
import { assertPeriodOpen } from './period-guard';
import { toNumber, asMoney } from './money';

type Tx = Prisma.TransactionClient;

/** PPN input tax added on top of the base amount; non-PPN tax types add no VAT leg. */
function ppnTaxOf(base: number, taxType: string, taxRate: unknown): number {
  if (taxType !== 'PPN') return 0;
  return asMoney(base * (toNumber(taxRate) / 100));
}

/**
 * Post Dr Expense / [Dr Input Tax] / Cr Bank for a direct bank EXPENSE, once.
 *
 * Returns the cash actually credited to the bank GL (base + recognised PPN), so
 * the caller can move the denormalised `bankAccount.currentBalance` by the exact
 * same amount and keep the cached balance in lockstep with the ledger. Returns 0
 * when nothing was posted (non-expense, already posted, or accounts unresolved).
 */
export async function postBankTransactionIfNeeded(tx: Tx, orgId: string, txnId: string): Promise<number> {
  const txn = await tx.bankTransaction.findFirst({ where: { id: txnId, organizationId: orgId } });
  if (!txn || txn.journalEntryId || txn.type !== 'EXPENSE') return 0;

  const base = toNumber(txn.amount);
  if (base <= 0) return 0;

  await assertPeriodOpen(tx, orgId, new Date(txn.date));

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const bankAccountRows = await tx.bankAccount.findMany({
    where: { organizationId: orgId },
    select: { id: true, code: true, name: true, bankName: true },
  });
  // resolveBankLinkedAssetAccountId expects optional (not nullable) string fields.
  const bankAccounts = bankAccountRows.map((b) => ({
    id: b.id,
    name: b.name ?? undefined,
    code: b.code ?? undefined,
    bankName: b.bankName ?? undefined,
  }));
  const settings = await loadOrgAccountDefaults(tx, orgId);

  const bankGlId = resolveBankLinkedAssetAccountId(bankAccounts, accounts, settings, txn.bankAccountId);
  const expenseId = txn.expenseAccountId ?? resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  const inputTaxId = resolveAccountDefaultId(accounts, settings, 'apTax');
  if (!bankGlId || !expenseId) return 0;

  const tax = ppnTaxOf(base, txn.taxType, txn.taxRate);
  const ref = txn.number ?? txn.reference ?? txn.id;

  const lines: Array<{ accountId: string; description: string; debit: number; credit: number }> = [
    { accountId: expenseId, description: `Expense - ${ref}`, debit: base, credit: 0 },
  ];
  // Only recognise input tax when both the tax and the account resolve; the
  // bank credit always equals the sum of debits so the entry stays balanced.
  let bankCredit = base;
  if (tax > 0 && inputTaxId) {
    lines.push({ accountId: inputTaxId, description: `Input tax - ${ref}`, debit: tax, credit: 0 });
    bankCredit = asMoney(base + tax);
  }
  lines.push({ accountId: bankGlId, description: `Bank disbursement - ${ref}`, debit: 0, credit: bankCredit });

  const je = await postJournalEntry(tx, {
    organizationId: orgId,
    date: new Date(txn.date),
    memo: `Bank expense: ${ref}`,
    lines,
  });

  await tx.bankTransaction.update({ where: { id: txn.id }, data: { journalEntryId: je.id } });

  return bankCredit;
}
