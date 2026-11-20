/**
 * Guards automatic GL posting against closed/locked accounting periods.
 *
 * The manual journal-entry route already rejects posting into a CLOSED or
 * locked period (by explicit periodId). Documents that post automatically —
 * invoices on SEND, bills on OPEN/APPROVED, AR/AP payments — never carried that
 * check, so a signed-off period could still be mutated after the fact. This
 * helper closes that gap: every automatic posting path resolves the period by
 * the posting date and refuses to write into it once locked.
 *
 * A date that falls outside every defined period is allowed — an undefined
 * period is simply "not yet closed" — unless it falls inside a closed fiscal
 * year. Throws `ApiError(422)`, which the route `withHandler` wrapper
 * translates into a clean client error.
 */
import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { accountingDay, toAccountingDate } from './accounting-date';
import { advisoryLockKey } from './advisory-lock';
import {
  assertTransactionDateAllowed,
  type TransactionDateGuardOptions,
} from './transaction-date-policy';

type Tx = Prisma.TransactionClient;

export async function lockOpenAccountingPeriod(
  tx: Tx,
  organizationId: string,
  date: Date,
): Promise<void> {
  // Periods are matched on the accounting date (the Jakarta business day, see
  // lib/accounting-date.ts), not the raw instant. A clock-time posting at 02:00
  // WIB on the 1st is 19:00 UTC on the last day of the previous month; matched
  // raw, it would land in (and be blocked by) the previous month while every
  // report puts it in the new one.
  const accountingDate = toAccountingDate(date);
  // A closed fiscal year refuses postings on its own, independent of period
  // rows: a year can be closed while some of its months have no period row
  // (later years get rows only when generated), and a closed month without
  // linked manual journals can be deleted. Either way a posting would land
  // after the closing entry and leave it stale (#170). The shared lock pairs
  // with the exclusive one closeFiscalYear and the year reopen take: a close
  // waits for in-flight postings, and a posting waiting on a close re-reads
  // FiscalYearClose below with a fresh snapshot once the close commits. It is
  // taken before the period row, matching the close's lock order.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${advisoryLockKey(`fiscal-year:${organizationId}`)})`;
  // Lock the matching period row FOR SHARE (if one exists). Concurrent posts
  // share the lock and don't block each other, but a concurrent period-close
  // (FOR UPDATE on the same row) waits for in-flight posts to commit and blocks
  // new posts until it finishes — closing the close-vs-post TOCTOU. When the
  // posting date falls outside every defined period the query returns no row and
  // takes no lock, preserving the auto-open ("not yet closed") behavior.
  const rows = await tx.$queryRaw<
    Array<{ name: string; status: string; isLocked: boolean }>
  >`
    SELECT "name", "status", "isLocked"
    FROM "AccountingPeriod"
    WHERE "organizationId" = ${organizationId}
      AND "startDate" <= ${accountingDate}
      AND "endDate" >= ${accountingDate}
    LIMIT 1
    FOR SHARE
  `;
  const period = rows[0];

  if (period && (period.status === 'CLOSED' || period.isLocked)) {
    const on = accountingDay(date);
    throw new ApiError(
      `Accounting period "${period.name}" is closed/locked — cannot post on ${on}`,
      422,
    );
  }

  // A separate statement after the lock, so it sees a close that committed
  // while this transaction waited.
  const closedYears = await tx.$queryRaw<Array<{ startDate: Date; endDate: Date }>>`
    SELECT "startDate", "endDate"
    FROM "FiscalYearClose"
    WHERE "organizationId" = ${organizationId}
      AND "startDate" <= ${accountingDate}
      AND "endDate" >= ${accountingDate}
    LIMIT 1
  `;
  if (closedYears[0]) {
    // The year's bounds are UTC calendar boundaries (endDate is its last
    // millisecond), so take their calendar days directly, as the close does.
    const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const { startDate, endDate } = closedYears[0];
    throw new ApiError(
      `Fiscal year ${day(startDate)} to ${day(endDate)} is closed — cannot post on ${accountingDay(date)}. Reopen the fiscal year first.`,
      422,
    );
  }

}

export async function assertPeriodOpen(
  tx: Tx,
  organizationId: string,
  date: Date,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  await lockOpenAccountingPeriod(tx, organizationId, date);
  // The transaction-date window (Accurate's "Pembatasan Tanggal Transaksi")
  // rides along here rather than being wired up separately, so it inherits this
  // guard's coverage: `period-guard-policy.test.ts` proves every journal-writing
  // path reaches this function, which makes the window impossible to miss on one.
  //
  // Checked second because the period lock is the stronger statement — when a
  // date is both in a closed month and outside the window, "the month is closed"
  // is the more useful thing to be told.
  await assertTransactionDateAllowed(tx, organizationId, date, opts);
}
