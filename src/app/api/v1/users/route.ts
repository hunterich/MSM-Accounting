import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireOrg, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission, authActor } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { createUserInputSchema } from '@/types/api';
import { hashPassword } from '@/lib/password';
import { roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'SETTINGS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const memberships = await prisma.userOrganization.findMany({
    where: { organizationId: orgId, isActive: true },
    include: {
      user: { select: { id: true, fullName: true, email: true, status: true } },
      role: { select: { name: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const data = memberships.map((m) => ({
    id: m.user.id,
    fullName: m.user.fullName,
    email: m.user.email,
    status: m.user.status,
    roleName: m.role.name,
  }));

  return ok({ data });
});

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const { orgId, userId: actorId } = requireAuth(req);
  const parsed = createUserInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid user payload', 400);
  const d = parsed.data;

  const role = await prisma.role.findFirst({
    where: { id: d.roleId, organizationId: orgId },
    include: { permissions: { where: { moduleKey: 'SETTINGS' }, select: { moduleKey: true, canEdit: true } } },
  });
  if (!role) return err('Role not found', 404);

  // Privilege-escalation guard: only an ADMIN actor may create a user bound to an
  // admin-capable role. Mirrors users/[id]/role PUT — without this, a non-admin
  // with SETTINGS.create could mint a full administrator account.
  if (roleGrantsSettingsEdit(role.roleType, role.permissions) && authActor(req).roleType !== 'ADMIN') {
    return err('Only an administrator can assign an admin-level role', 403);
  }

  const email = d.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return err('A user with that email already exists', 409);

  // Generate a readable, policy-compliant temp password when none supplied
  // (>=8 chars, has a letter and a digit). User must change it on first login.
  const tempPassword = d.password ?? `Msm-${tempSeed(email)}a1`;
  const passwordHash = await hashPassword(tempPassword);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, fullName: d.fullName, passwordHash, mustChangePassword: true } });
    await tx.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: d.roleId, isActive: true } });
    return user;
  });
  logAudit({ orgId, actorId, entityType: 'User', entityId: created.id, action: 'CREATE', payload: { email: created.email } });
  return ok({ id: created.id, email: created.email, fullName: created.fullName, temporaryPassword: d.password ? undefined : tempPassword }, 201);
});

// Deterministic readable seed for a temp password; the user must change it anyway.
function tempSeed(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36).slice(0, 6); }
