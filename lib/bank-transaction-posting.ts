/**
 * GL posting for direct bank transactions (Accurate's "Pembayaran" / "Penerimaan"
 * / "Transfer") and for a bank account's opening balance.
 *
 *   EXPENSE : Dr Expense / [Dr Input Tax]  / Cr Bank      (cash out of a bank)
 *   INCOME  : Dr Bank    / [Cr Output Tax] / Cr Income    (cash into a bank)
 *   TRANSFER: Dr destination Bank          / Cr source Bank
 *   OPENING : Dr Bank    / Cr Opening Balance Equity      (onboarding a balance)
 *
 * `journalEntryId` is the idempotency token — set in the same transaction as the
 * journal entry, so re-running is a no-op. Each posting also reports the cached
 * `bankAccount.currentBalance` movements (`moves`) so the caller keeps the
 * denormalised balance in lockstep with the ledger. The balance moves are
 * reported even when the GL entry cannot be posted (unresolved accounts), so the
 * cached balance still reflects the cash movement.
 *
 * The line/move computation is single-sourced in `buildBankPosting`, so the
 * create path (`postBankTransactionIfNeeded`) and the edit path's storno
 * (`reverseBankTransactionPosting`) always agree on the cached-balance effect.
 *
 * Tax convention matches the entry form: `amount` is the pre-tax BASE and PPN is
 * added on top. Tax types other than PPN (GST / withholding) add no VAT leg.
 */
import type { Prisma, BankTransaction } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { reverseJournalEntry } from './reverse-journal-entry';
import {
  resolveAccountDefaultId,
  resolveBankLinkedAssetAccountId,
  loadOrgAccountDefaults,
} from './account-defaults';
import { assertPeriodOpen } from './period-guard';
import { toNumber, asMoney } from './money';

type Tx = Prisma.TransactionClient;

type JournalLine = { accountId: string; description: string; debit: number; credit: number };

export interface BankPostingResult {
  /** The posted journal entry id, or null when nothing was posted. */
  journalEntryId: string | null;
  /** Cached-balance deltas to apply to each affected bank account. */
  moves: Array<{ bankAccountId: string; delta: number }>;
}

const NOTHING: BankPostingResult = { journalEntryId: null, moves: [] };

/** PPN added on top of the base amount; non-PPN tax types add no VAT leg. */
function ppnTaxOf(base: number, taxType: string, taxRate: unknown): number {
  if (taxType !== 'PPN') return 0;
  return asMoney(base * (toNumber(taxRate) / 100));
}

/**
 * Load the org's chart of accounts, bank accounts, and account-default overrides
 * — everything `buildBankPosting` / `postBankOpeningBalance` need to resolve GL
 * accounts. Shared so every posting reads the same data the same way.
 */
export async function loadBankPostingContext(tx: Tx, orgId: string) {
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
  return { accounts, bankAccounts, settings };
}

type BankPostingContext = Awaited<ReturnType<typeof loadBankPostingContext>>;

interface BankPosting {
  /** Cached-balance deltas this transaction applies to each affected bank account. */
  moves: BankPostingResult['moves'];
  /** Balanced journal lines — empty when the GL accounts cannot be resolved. */
  lines: JournalLine[];
  memo: string;
  /** Whether the GL accounts resolved and a journal entry can be posted. */
  postable: boolean;
}

/**
 * Pure builder: derive the journal lines and the cached-balance moves for a bank
 * transaction (EXPENSE / INCOME / TRANSFER). The cash moved always equals the
 * sum of the offsetting legs, so the entry stays balanced. `moves` is reported
 * even when `postable` is false, so the cached balance still reflects the cash
 * movement when the GL accounts can't be resolved.
 */
function buildBankPosting(txn: BankTransaction, ctx: BankPostingContext): BankPosting {
  const { accounts, bankAccounts, settings } = ctx;
  const base = toNumber(txn.amount);
  const srcBankGlId = resolveBankLinkedAssetAccountId(bankAccounts, accounts, settings, txn.bankAccountId);
  const ref = txn.number ?? txn.reference ?? txn.id;

  if (txn.type === 'INCOME') {
    const incomeId = txn.incomeAccountId ?? resolveAccountDefaultId(accounts, settings, 'salesRevenue');
    const outputTaxId = resolveAccountDefaultId(accounts, settings, 'arTax');
    const tax = ppnTaxOf(base, txn.taxType, txn.taxRate);
    // Cash in always equals the sum of credits (base + recognised PPN).
    let bankDebit = base;
    const creditLines: JournalLine[] = [{ accountId: incomeId, description: `Income - ${ref}`, debit: 0, credit: base }];
    if (tax > 0 && outputTaxId) {
      creditLines.push({ accountId: outputTaxId, description: `Output tax - ${ref}`, debit: 0, credit: tax });
      bankDebit = asMoney(base + tax);
    }
    const moves = [{ bankAccountId: txn.bankAccountId, delta: bankDebit }];
    const postable = Boolean(srcBankGlId && incomeId);
    const lines = postable
      ? [{ accountId: srcBankGlId, description: `Bank receipt - ${ref}`, debit: bankDebit, credit: 0 }, ...creditLines]
      : [];
    return { moves, lines, memo: `Bank income: ${ref}`, postable };
  }

  if (txn.type === 'TRANSFER') {
    const moves = [{ bankAccountId: txn.bankAccountId, delta: -base }];
    const destBankGlId = txn.toBankAccountId
      ? resolveBankLinkedAssetAccountId(bankAccounts, accounts, settings, txn.toBankAccountId)
      : '';
    if (txn.toBankAccountId) moves.push({ bankAccountId: txn.toBankAccountId, delta: base });
    const postable = Boolean(txn.toBankAccountId && srcBankGlId && destBankGlId);
    const lines = postable
      ? [
          { accountId: destBankGlId, description: `Transfer in - ${ref}`, debit: base, credit: 0 },
          { accountId: srcBankGlId, description: `Transfer out - ${ref}`, debit: 0, credit: base },
        ]
      : [];
    return { moves, lines, memo: `Bank transfer: ${ref}`, postable };
  }

  // EXPENSE
  const expenseId = txn.expenseAccountId ?? resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  const inputTaxId = resolveAccountDefaultId(accounts, settings, 'apTax');
  const tax = ppnTaxOf(base, txn.taxType, txn.taxRate);
  // Cash out always equals the sum of debits (base + recognised PPN).
  let bankCredit = base;
  const debitLines: JournalLine[] = [{ accountId: expenseId, description: `Expense - ${ref}`, debit: base, credit: 0 }];
  if (tax > 0 && inputTaxId) {
    debitLines.push({ accountId: inputTaxId, description: `Input tax - ${ref}`, debit: tax, credit: 0 });
    bankCredit = asMoney(base + tax);
  }
  const moves = [{ bankAccountId: txn.bankAccountId, delta: -bankCredit }];
  const postable = Boolean(srcBankGlId && expenseId);
  const lines = postable
    ? [...debitLines, { accountId: srcBankGlId, description: `Bank disbursement - ${ref}`, debit: 0, credit: bankCredit }]
    : [];
  return { moves, lines, memo: `Bank expense: ${ref}`, postable };
}

/**
 * Post the GL entry for a direct bank transaction (EXPENSE / INCOME / TRANSFER),
 * once, and report the cached-balance movements. Idempotent via `journalEntryId`.
 */
export async function postBankTransactionIfNeeded(tx: Tx, orgId: string, txnId: string): Promise<BankPostingResult> {
  const txn = await tx.bankTransaction.findFirst({ where: { id: txnId, organizationId: orgId } });
  if (!txn || txn.journalEntryId) return NOTHING;

  const base = toNumber(txn.amount);
  if (base <= 0) return NOTHING;

  await assertPeriodOpen(tx, orgId, new Date(txn.date));

  const ctx = await loadBankPostingContext(tx, orgId);
  const { moves, lines, memo, postable } = buildBankPosting(txn, ctx);
  if (!postable) return { journalEntryId: null, moves };

  const je = await postJournalEntry(tx, { organizationId: orgId, date: new Date(txn.date), memo, lines });
  await tx.bankTransaction.update({ where: { id: txn.id }, data: { journalEntryId: je.id } });
  return { journalEntryId: je.id, moves };
}

/**
 * Storno the journal entry a bank transaction posted (if any) and report the
 * cached-balance moves to BACK OUT — the inverse of what the original posting
 * applied. Used by the edit path to undo a transaction before re-posting it from
 * the edited data, so both the GL and the cached balances stay in lockstep.
 *
 * The undo moves are derived from the transaction's *current* (pre-edit) fields
 * via the same `buildBankPosting` the create path used, so they cancel exactly.
 * The caller is responsible for clearing `journalEntryId` and re-posting.
 */
export async function reverseBankTransactionPosting(
  tx: Tx,
  orgId: string,
  txn: BankTransaction,
): Promise<BankPostingResult['moves']> {
  const ctx = await loadBankPostingContext(tx, orgId);
  const { moves } = buildBankPosting(txn, ctx);

  if (txn.journalEntryId) {
    const ref = txn.number ?? txn.reference ?? txn.id;
    await reverseJournalEntry(tx, txn.journalEntryId, {
      date: new Date(txn.date),
      memo: `Reversal of bank transaction: ${ref}`,
    });
  }

  return moves.map((m) => ({ bankAccountId: m.bankAccountId, delta: -m.delta }));
}

/**
 * Post the opening-balance journal for a bank account: Dr Bank / Cr Opening
 * Balance Equity (reversed for a negative opening). The account's cached
 * `currentBalance` is already set to the opening amount by the create handler,
 * so this only adds the GL side — the two stay in lockstep. Returns the journal
 * entry id, or null when nothing was posted (zero balance or unresolved accounts).
 */
export async function postBankOpeningBalance(
  tx: Tx,
  orgId: string,
  bankAccountId: string,
  openingBalance: unknown,
  date: Date,
): Promise<string | null> {
  const amount = asMoney(toNumber(openingBalance));
  if (amount === 0) return null;

  await assertPeriodOpen(tx, orgId, date);

  const { accounts, bankAccounts, settings } = await loadBankPostingContext(tx, orgId);

  const bankGlId = resolveBankLinkedAssetAccountId(bankAccounts, accounts, settings, bankAccountId);
  const equityId = resolveAccountDefaultId(accounts, settings, 'openingBalanceEquity');
  if (!bankGlId || !equityId) return null;

  const ref = bankAccounts.find((b) => b.id === bankAccountId)?.name ?? bankAccountId;
  const magnitude = Math.abs(amount);
  // Positive opening: Dr Bank / Cr Opening Balance Equity. Negative reverses both.
  const lines: JournalLine[] = amount > 0
    ? [
        { accountId: bankGlId, description: `Opening balance - ${ref}`, debit: magnitude, credit: 0 },
        { accountId: equityId, description: `Opening balance equity - ${ref}`, debit: 0, credit: magnitude },
      ]
    : [
        { accountId: equityId, description: `Opening balance equity - ${ref}`, debit: magnitude, credit: 0 },
        { accountId: bankGlId, description: `Opening balance - ${ref}`, debit: 0, credit: magnitude },
      ];

  const je = await postJournalEntry(tx, { organizationId: orgId, date, memo: `Bank opening balance: ${ref}`, lines });
  return je.id;
}
