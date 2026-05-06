/**
 * Test helper: asserts that a journal entry's lines sum to total debit ===
 * total credit (within a half-cent tolerance to absorb Decimal rounding).
 *
 * Two entry points so callers can use whichever is more convenient:
 *
 *   assertLinesBalanced(lines)        → pure: when the test already has the
 *                                       lines array in hand (e.g. captured
 *                                       from a mocked `journalLine.createMany`).
 *
 *   assertJournalBalances(prisma, id) → queries `JournalLine` rows via the
 *                                       provided Prisma-like client. Use in
 *                                       integration tests against a real DB
 *                                       or against a mock where a `findMany`
 *                                       has been programmed.
 */
import { toNumber, asMoney } from '../money';

const TOLERANCE = 0.005; // half a cent

export interface BalanceableLine {
  debit: unknown;
  credit: unknown;
}

interface JournalLineFinder {
  journalLine: {
    findMany: (args: {
      where: { entryId: string };
      select: { debit: true; credit: true };
    }) => Promise<BalanceableLine[]>;
  };
}

export function assertLinesBalanced(lines: BalanceableLine[]): void {
  if (!lines.length) {
    throw new Error('assertLinesBalanced: lines[] is empty');
  }
  const totalDebit = asMoney(lines.reduce((s, l) => s + toNumber(l.debit), 0));
  const totalCredit = asMoney(lines.reduce((s, l) => s + toNumber(l.credit), 0));

  if (Math.abs(totalDebit - totalCredit) > TOLERANCE) {
    throw new Error(
      `Journal not balanced: debit=${totalDebit} credit=${totalCredit} ` +
        `diff=${(totalDebit - totalCredit).toFixed(4)}`,
    );
  }
}

export async function assertJournalBalances(
  prismaLike: JournalLineFinder,
  entryId: string,
): Promise<void> {
  const lines = await prismaLike.journalLine.findMany({
    where: { entryId },
    select: { debit: true, credit: true },
  });
  if (!lines.length) {
    throw new Error(`Journal entry ${entryId} has no lines`);
  }
  assertLinesBalanced(lines);
}
