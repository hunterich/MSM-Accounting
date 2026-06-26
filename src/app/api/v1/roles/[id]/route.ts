import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { updateRoleInputSchema } from '@/types/api';
import { normalizePermissionMatrix, roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';
import type { ModuleKey } from '@prisma/client';

export const runtime = 'nodejs';
export function OPTIONS() { return corsPreflightResponse(); }

// Will the org still have an active member whose role can administer settings,
// if role `changedRoleId` ends up with (nextRoleType, nextRows)? Prevents lockout.
async function orgRetainsAdmin(
  orgId: string,
  changedRoleId: string,
  nextRoleType: string,
  nextRows: Array<{ moduleKey: ModuleKey; canEdit?: boolean }>,
): Promise<boolean> {
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId, isActive: true, memberships: { some: { isActive: true } } },
    include: { permissions: { where: { moduleKey: 'SETTINGS' }, select: { moduleKey: true, canEdit: true } } },
  });
  return roles.some((r) =>
    r.id === changedRoleId
      ? roleGrantsSettingsEdit(nextRoleType, nextRows)
      : roleGrantsSettingsEdit(r.roleType, r.permissions),
  );
}

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = requireAuth(req);
  const { id } = await params;
  const existing = await prisma.role.findFirst({ where: { id, organizationId: orgId }, include: { permissions: true } });
  if (!existing) return err('Role not found', 404);

  const parsed = updateRoleInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid role payload', 400);
  const d = parsed.data;

  const nextType = d.roleType ?? existing.roleType;
  const nextRows = d.permissions !== undefined
    ? normalizePermissionMatrix(d.permissions as never)
    : existing.permissions.map((p) => ({ moduleKey: p.moduleKey, canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete, canApprove: p.canApprove }));
  const nextActive = d.isActive ?? existing.isActive;

  // Lockout guard: only worth checking when this role would lose admin-capability
  // (deactivated, or no longer grants SETTINGS edit).
  if (!nextActive || !roleGrantsSettingsEdit(nextType, nextRows)) {
    const retains = await orgRetainsAdmin(orgId, id, nextActive ? nextType : 'NONE', nextActive ? nextRows : []);
    if (!retains) return err('This change would leave the organization with no administrator', 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: {
        name: d.name ?? undefined,
        roleType: d.roleType ?? undefined,
        invoiceAccessScope: d.invoiceAccessScope ?? undefined,
        isActive: d.isActive ?? undefined,
        allowedDays: d.allowedDays === undefined ? undefined : (d.allowedDays === null ? Prisma.JsonNull : (d.allowedDays as Prisma.InputJsonValue)),
        startTime: d.startTime === undefined ? undefined : d.startTime,
        endTime: d.endTime === undefined ? undefined : d.endTime,
      },
    });
    if (d.permissions !== undefined) {
      for (const m of nextRows) {
        await tx.rolePermission.upsert({
          where: { roleId_moduleKey: { roleId: id, moduleKey: m.moduleKey as ModuleKey } },
          create: { roleId: id, moduleKey: m.moduleKey as ModuleKey, canView: m.canView, canCreate: m.canCreate, canEdit: m.canEdit, canDelete: m.canDelete, canApprove: m.canApprove },
          update: { canView: m.canView, canCreate: m.canCreate, canEdit: m.canEdit, canDelete: m.canDelete, canApprove: m.canApprove },
        });
      }
    }
  });
  logAudit({ orgId, actorId: userId, entityType: 'Role', entityId: id, action: 'UPDATE', payload: { name: d.name } });
  const updated = await prisma.role.findUnique({ where: { id }, include: { permissions: true } });
  return ok(updated);
});

export const DELETE = withPermission({ module: 'SETTINGS', action: 'delete' }, async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = requireAuth(req);
  const { id } = await params;
  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { memberships: { where: { isActive: true } } } } },
  });
  if (!role) return err('Role not found', 404);
  if (role.roleType === 'ADMIN') return err('The Admin role cannot be deleted', 409);
  if (role._count.memberships > 0) return err('Reassign users off this role before deleting it', 409);
  await prisma.role.delete({ where: { id } });
  logAudit({ orgId, actorId: userId, entityType: 'Role', entityId: id, action: 'DELETE', payload: { name: role.name } });
  return ok({ id });
});
