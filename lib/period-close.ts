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
import { ApiError } from './errors';
import { pendingFinancialInPeriod } from './approval/financial-period';
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

/** Shared by the real close API and deterministic close/submission races. */
export async function closeAccountingPeriod(tx: Tx, orgId: string, userId: string, id: string) {
  // Lock the period row FOR UPDATE before the unposted-count + CLOSED update.
  // Without it, find → count → update run as three autocommit statements and a
  // concurrent post (whose assertPeriodOpen read is unlocked) can slip a
  // journal entry into the period between the count and the close (TOCTOU).
  // The lock conflicts with assertPeriodOpen's FOR SHARE, so in-flight posts
  // block this close until they commit, and new posts block until it commits.
  const [period] = await tx.$queryRaw<
    Array<{ id: string; status: string; startDate: Date; endDate: Date }>
  >`
    SELECT "id", "status", "startDate", "endDate" FROM "AccountingPeriod"
    WHERE "id" = ${id} AND "organizationId" = ${orgId}
    FOR UPDATE
  `;
  if (!period) throw new ApiError('Accounting period not found', 404);
  if (period.status === 'CLOSED') {
    throw new ApiError('Accounting period is already closed', 422);
  }

  const unpostedCount = await countUnpostedInPeriod(tx, orgId, period.startDate, period.endDate);
  if (unpostedCount > 0) {
    throw new ApiError(
      `Cannot close period: ${unpostedCount} unposted journal entr${unpostedCount === 1 ? 'y' : 'ies'} must be posted first`,
      422,
    );
  }

  const pending = await pendingFinancialInPeriod(tx, orgId, period.startDate, period.endDate);
  const count = pending.reduce((sum, item) => sum + item.count, 0);
  if (count > 0) {
    const detail = pending.filter(item => item.count > 0).map(item => `${item.documentType}: ${item.count}`).join(', ');
    throw new ApiError(`Cannot close period: approve or reject ${count} pending financial document(s) dated in this period (${detail})`, 422);
  }

  return tx.accountingPeriod.update({
    where: { id, organizationId: orgId },
    data: { status: 'CLOSED', isLocked: true, closedAt: new Date(), closedById: userId },
  });
}
