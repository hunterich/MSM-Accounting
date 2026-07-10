import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, ok, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { advisoryLockKey } from '@/lib/advisory-lock';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Remove a user from the caller's active company (soft delete — sets
 * `isActive: false`, per spec §6). The membership is fetched WITH an
 * `organizationId` filter so a caller can never touch another org's membership
 * (cross-org guard → 404).
 *
 * Last-admin guard: an ADMIN membership can only be removed while another active
 * ADMIN remains, so a company is never left without an administrator (422).
 */
export const DELETE = withPermission({ module: 'SETTINGS', action: 'edit' }, async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId: actorId } = requireAuth(req);
  const { id } = await params;

  // The last-admin guard is check-then-act (fetch → count other admins →
  // deactivate). Run unlocked, two concurrent removals of the two remaining
  // admins each see the OTHER as still active and both pass, leaving the org
  // with ZERO admins. Serialize the whole guard under a per-org, xact-scoped
  // advisory lock (released at commit/rollback) so the loser blocks and re-reads
  // the winner's committed state. Mirrors organizations/route.ts.
  const removed = await prisma.$transaction(async (tx) => {
    const lockKey = advisoryLockKey(`org-admin:${orgId}`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const membership = await tx.userOrganization.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, userId: true, role: { select: { roleType: true } } },
    });
    if (!membership) throw new ApiError('Membership not found', 404);

    if (membership.role.roleType === 'ADMIN') {
      const otherAdmins = await tx.userOrganization.count({
        where: {
          organizationId: orgId,
          isActive: true,
          id: { not: membership.id },
          role: { roleType: 'ADMIN' },
        },
      });
      if (otherAdmins === 0) throw new ApiError('Cannot remove the last administrator', 422);
    }

    await tx.userOrganization.update({
      where: { id: membership.id },
      data: { isActive: false },
    });
    return { id: membership.id, userId: membership.userId };
  });

  logAudit({
    orgId,
    actorId,
    entityType: 'UserOrganization',
    entityId: removed.id,
    action: 'DELETE',
    payload: { userId: removed.userId },
  });
  return ok({ id: removed.id, isActive: false });
});
