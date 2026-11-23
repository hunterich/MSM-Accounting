import type { Prisma } from '@prisma/client';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';

export function normalizeJournalAmounts<T extends { debit: Prisma.Decimal.Value; credit: Prisma.Decimal.Value }>(lines: readonly T[]) {
  const rounded = lines.map(line => ({ ...line, debit: roundMoneyDecimal(line.debit), credit: roundMoneyDecimal(line.credit) }));
  const totalDebit = rounded.reduce((sum, line) => sum.plus(line.debit), new MoneyDecimal(0));
  const totalCredit = rounded.reduce((sum, line) => sum.plus(line.credit), new MoneyDecimal(0));
  return { lines: rounded, totalDebit, totalCredit };
}
