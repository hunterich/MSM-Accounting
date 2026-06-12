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
  const period = await tx.accountingPeriod.findFirst({
    where: {
      organizationId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { name: true, status: true, isLocked: true },
  });

  if (period && (period.status === 'CLOSED' || period.isLocked)) {
    const on = date.toISOString().slice(0, 10);
    throw new ApiError(
      `Accounting period "${period.name}" is closed/locked — cannot post on ${on}`,
      422,
    );
  }
}
