import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { roundMoneyDecimal } from './money-decimal';

export function calculateBankAmounts(input: {
  amount: Decimal.Value; type: string; taxType?: string; taxRate?: Decimal.Value;
}) {
  const base = roundMoneyDecimal(input.amount);
  const rate = roundMoneyDecimal(input.taxRate ?? 0);
  const tax = input.type !== 'TRANSFER' && input.taxType === 'PPN'
    ? roundMoneyDecimal(base.mul(rate).div(100))
    : roundMoneyDecimal(0);
  return { base, rate, tax, cash: base.plus(tax) };
}

export const bankCashJournal = { select: { totalDebit: true } } as const;

type BankCashRecord = {
  amount: Decimal.Value;
  cashAmount?: Decimal.Value | null;
  type: string;
  taxType: string;
  taxRate: Decimal.Value;
  journalEntry?: { totalDebit: Decimal.Value } | null;
};

/** Older direct bank journals have one cash leg on one side of the entry.
 * Its original amount survives changes in the tax calculation and mappings. */
export function recordedBankCashAmount(transaction: BankCashRecord) {
  const recorded = transaction.cashAmount ?? transaction.journalEntry?.totalDebit;
  if (recorded != null) return roundMoneyDecimal(recorded);
  const amounts = calculateBankAmounts(transaction);
  return amounts.tax.isZero() ? amounts.base.abs() : null;
}

export function signedBankCashAmount(
  transaction: BankCashRecord & { bankAccountId: string; toBankAccountId?: string | null },
  accountId: string,
) {
  const cash = recordedBankCashAmount(transaction);
  if (!cash?.gt(0)) return null;
  if (transaction.bankAccountId === accountId) return transaction.type === 'INCOME' ? cash : cash.negated();
  return transaction.type === 'TRANSFER' && transaction.toBankAccountId === accountId ? cash : null;
}
