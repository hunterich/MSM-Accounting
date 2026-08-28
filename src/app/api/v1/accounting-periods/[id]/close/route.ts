import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireAuth } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { countUnpostedInPeriod } from '@/lib/period-close';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Close (lock) a monthly accounting period.
 *
 * Closing is what makes `assertPeriodOpen` start refusing posts dated inside
 * the period — see lib/period-guard.ts. It is reversible via the sibling
 * /reopen route, so this is a signed-off marker rather than a one-way door.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { orgId, userId } = requireAuth(req);

  const updated = await prisma.$transaction(async (tx) => {
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

    return tx.accountingPeriod.update({
      where: { id, organizationId: orgId },
      data: { status: 'CLOSED', isLocked: true, closedAt: new Date(), closedById: userId },
    });
  });

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'close' },
  });

  return ok(updated);
});
