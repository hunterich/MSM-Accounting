import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireAuth } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Reopen a closed accounting period.
 *
 * Gated by the same SETTINGS/edit permission as closing: whoever can sign a
 * period off can un-sign it. Every reopen writes an audit-log row naming the
 * original closer, so the trail survives the stamp being cleared.
 *
 * Deliberately simple, and only safe while a monthly close is a pure lock: no
 * closing journal entry exists to unwind. When fiscal-year closing entries land
 * (issue #29 part 3), reopening a year-end period must also delete its closing
 * JE, or the lock and the entry drift apart — do not extend this route to
 * year-end periods without that.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { orgId, userId } = requireAuth(req);

  const { updated, previousCloser } = await prisma.$transaction(async (tx) => {
    // Same FOR UPDATE lock as close: it conflicts with assertPeriodOpen's FOR
    // SHARE, so a post can never observe a half-reopened period.
    const [period] = await tx.$queryRaw<
      Array<{ id: string; status: string; closedById: string | null; closedAt: Date | null }>
    >`
      SELECT "id", "status", "closedById", "closedAt" FROM "AccountingPeriod"
      WHERE "id" = ${id} AND "organizationId" = ${orgId}
      FOR UPDATE
    `;
    if (!period) throw new ApiError('Accounting period not found', 404);
    if (period.status !== 'CLOSED') {
      throw new ApiError('Accounting period is not closed', 422);
    }

    const row = await tx.accountingPeriod.update({
      where: { id, organizationId: orgId },
      data: { status: 'OPEN', isLocked: false, closedAt: null, closedById: null },
    });
    return { updated: row, previousCloser: { id: period.closedById, at: period.closedAt } };
  });

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    // The stamp is cleared on the row, so record who it named before this ran —
    // otherwise the audit trail loses who had closed the period.
    payload: {
      action: 'reopen',
      previouslyClosedById: previousCloser.id,
      previouslyClosedAt: previousCloser.at?.toISOString() ?? null,
    },
  });

  return ok(updated);
});
