/**
 * Shared period-close helpers.
 *
 * The one non-obvious piece is how "unposted journal entries in this period" is
 * counted. `JournalEntry.periodId` exists but is only ever populated when a
 * client explicitly supplies it on a manual journal-entry create/update —
 * every automatic posting path (invoices on send, bills, payments, returns,
 * depreciation, payroll…) leaves it null. Counting `where periodId = <period>`
 * therefore misses almost every draft, so the pre-close check it guarded was
 * passing on periods that were full of unposted work.
 *
 * Membership is resolved by DATE instead, which is the same rule
 * `assertPeriodOpen` enforces on the write side (lib/period-guard.ts). Keeping
 * both on the date means a period cannot be closed over drafts that would
 * later be refused, and a backdated entry cannot slip past either check.
 */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Draft (unposted) journal entries whose DATE falls inside the period. */
export async function countUnpostedInPeriod(
  tx: Tx,
  organizationId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  return tx.journalEntry.count({
    where: {
      organizationId,
      status: 'DRAFT',
      date: { gte: startDate, lte: endDate },
    },
  });
}
