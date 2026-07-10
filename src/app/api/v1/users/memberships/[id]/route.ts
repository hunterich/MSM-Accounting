import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';

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

  const membership = await prisma.userOrganization.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, userId: true, role: { select: { roleType: true } } },
  });
  if (!membership) return err('Membership not found', 404);

  if (membership.role.roleType === 'ADMIN') {
    const otherAdmins = await prisma.userOrganization.count({
      where: {
        organizationId: orgId,
        isActive: true,
        id: { not: membership.id },
        role: { roleType: 'ADMIN' },
      },
    });
    if (otherAdmins === 0) return err('Cannot remove the last administrator', 422);
  }

  await prisma.userOrganization.update({
    where: { id: membership.id },
    data: { isActive: false },
  });

  logAudit({
    orgId,
    actorId,
    entityType: 'UserOrganization',
    entityId: membership.id,
    action: 'DELETE',
    payload: { userId: membership.userId },
  });
  return ok({ id: membership.id, isActive: false });
});
