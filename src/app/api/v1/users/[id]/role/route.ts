import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { assignUserRoleInputSchema } from '@/types/api';
import { roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';

export const runtime = 'nodejs';
export function OPTIONS() { return corsPreflightResponse(); }

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId: actorId } = requireAuth(req);
  const { id: targetUserId } = await params;
  const parsed = assignUserRoleInputSchema.safeParse(await req.json());
  if (!parsed.success) return err('Invalid payload', 400);

  const membership = await prisma.userOrganization.findUnique({ where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } } });
  if (!membership) return err('User is not a member of this organization', 404);
  const newRole = await prisma.role.findFirst({
    where: { id: parsed.data.roleId, organizationId: orgId },
    include: { permissions: { where: { moduleKey: 'SETTINGS' }, select: { moduleKey: true, canEdit: true } } },
  });
  if (!newRole) return err('Role not found', 404);

  // Lockout guard: if the new role isn't admin-capable, ensure some OTHER active
  // member still is, before moving this user off an admin-capable role.
  if (!roleGrantsSettingsEdit(newRole.roleType, newRole.permissions)) {
    const otherAdmins = await prisma.userOrganization.count({
      where: {
        organizationId: orgId, isActive: true, userId: { not: targetUserId },
        role: { OR: [{ roleType: 'ADMIN' }, { permissions: { some: { moduleKey: 'SETTINGS', canEdit: true } } }] },
      },
    });
    if (otherAdmins === 0) return err('This would leave the organization with no administrator', 409);
  }

  await prisma.userOrganization.update({
    where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    data: { roleId: parsed.data.roleId },
  });
  logAudit({ orgId, actorId, entityType: 'UserOrganization', entityId: membership.id, action: 'UPDATE', payload: { targetUserId, roleId: parsed.data.roleId } });
  return ok({ userId: targetUserId, roleId: parsed.data.roleId });
});
