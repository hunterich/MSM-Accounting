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
 * period is simply "not yet closed". Throws `ApiError(422)`, which the route
 * `withHandler` wrapper translates into a clean client error.
 */
import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

type Tx = Prisma.TransactionClient;

export async function assertPeriodOpen(
  tx: Tx,
  organizationId: string,
  date: Date,
): Promise<void> {
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
      AND "startDate" <= ${date}
      AND "endDate" >= ${date}
    LIMIT 1
    FOR SHARE
  `;
  const period = rows[0];

  if (period && (period.status === 'CLOSED' || period.isLocked)) {
    const on = date.toISOString().slice(0, 10);
    throw new ApiError(
      `Accounting period "${period.name}" is closed/locked — cannot post on ${on}`,
      422,
    );
  }
}
