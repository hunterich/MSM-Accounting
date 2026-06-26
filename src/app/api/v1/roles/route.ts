import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireOrg, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission, authActor } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { createRoleInputSchema } from '@/types/api';
import { normalizePermissionMatrix, roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';
import type { ModuleKey, RoleType, InvoiceAccessScope } from '@prisma/client';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'SETTINGS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId },
    include: { permissions: true, _count: { select: { memberships: { where: { isActive: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ data: roles.map((r) => ({
    id: r.id, name: r.name, roleType: r.roleType, invoiceAccessScope: r.invoiceAccessScope,
    isActive: r.isActive, allowedDays: r.allowedDays, startTime: r.startTime, endTime: r.endTime,
    memberCount: r._count.memberships,
    permissions: r.permissions.map((p) => ({
      moduleKey: p.moduleKey, canView: p.canView, canCreate: p.canCreate,
      canEdit: p.canEdit, canDelete: p.canDelete, canApprove: p.canApprove,
    })),
  })) });
});

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const { orgId, userId } = requireAuth(req);
  const parsed = createRoleInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid role payload', 400);
  const d = parsed.data;
  const matrix = normalizePermissionMatrix(d.permissions as never);

  // Privilege-escalation guard: only an ADMIN actor may mint an admin-capable
  // role (ADMIN type or SETTINGS.canEdit grants a full check-bypass).
  if (roleGrantsSettingsEdit(d.roleType ?? 'CUSTOM', matrix) && authActor(req).roleType !== 'ADMIN') {
    return err('Only an administrator can create an admin-level role', 403);
  }

  try {
    const role = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: d.name,
        roleType: (d.roleType ?? 'CUSTOM') as RoleType,
        invoiceAccessScope: (d.invoiceAccessScope ?? 'ALL') as InvoiceAccessScope,
        isActive: d.isActive ?? true,
        allowedDays: d.allowedDays != null ? (d.allowedDays as Prisma.InputJsonValue) : undefined,
        startTime: d.startTime ?? null,
        endTime: d.endTime ?? null,
        permissions: { create: matrix.map((m) => ({ ...m, moduleKey: m.moduleKey as ModuleKey })) },
      },
      include: { permissions: true },
    });
    logAudit({ orgId, actorId: userId, entityType: 'Role', entityId: role.id, action: 'CREATE', payload: { name: role.name } });
    return ok(role, 201);
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
      return err('A role with that name already exists', 409);
    }
    throw e;
  }
});
