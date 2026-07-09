import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);

  const updated = await prisma.$transaction(async (tx) => {
    // Lock the period row FOR UPDATE before the DRAFT-count + CLOSED update.
    // Without it, find → count → update run as three autocommit statements and a
    // concurrent post (whose assertPeriodOpen read is unlocked) can slip a
    // journal entry into the period between the count and the close (TOCTOU).
    // The lock conflicts with assertPeriodOpen's FOR SHARE, so in-flight posts
    // block this close until they commit, and new posts block until it commits.
    const [period] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "AccountingPeriod"
      WHERE "id" = ${id} AND "organizationId" = ${orgId}
      FOR UPDATE
    `;
    if (!period) throw new ApiError('Accounting period not found', 404);
    if (period.status === 'CLOSED') {
      throw new ApiError('Accounting period is already closed', 422);
    }

    const unpostedCount = await tx.journalEntry.count({
      where: { organizationId: orgId, periodId: id, status: 'DRAFT' },
    });
    if (unpostedCount > 0) {
      throw new ApiError(
        `Cannot close period: ${unpostedCount} unposted journal entr${unpostedCount === 1 ? 'y' : 'ies'} must be posted first`,
        422,
      );
    }

    return tx.accountingPeriod.update({
      where: { id, organizationId: orgId },
      data: { status: 'CLOSED', isLocked: true },
    });
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'close' },
  });

  return ok(updated);
});
