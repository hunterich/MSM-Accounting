import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission, authActor } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

const addMembershipSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  roleId: z.string().trim().min(1, 'A role is required'),
});

/**
 * Add an EXISTING user to the caller's active company with a per-company role.
 * Creating brand-new user accounts stays in the Users-tab flow (POST /users);
 * this endpoint only grants an already-registered user access to this org.
 *
 * Upserts on the `@@unique([userId, organizationId])` constraint: a previously
 * removed (inactive) membership is reactivated with the new role; an active one
 * is a 409. The invitee's token picks up the membership on next login/refresh.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(req: NextRequest) {
  const { orgId, userId: actorId } = requireAuth(req);
  const parsed = addMembershipSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid membership payload', 400);

  // Invitee must already exist — emails are stored lowercased (see users POST).
  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return err('User not found', 404);

  // The role must belong to THIS org (cross-org guard) — 404 otherwise, and
  // nothing is created. Load its SETTINGS permission for the escalation guard.
  const role = await prisma.role.findFirst({
    where: { id: parsed.data.roleId, organizationId: orgId },
    include: { permissions: { where: { moduleKey: 'SETTINGS' }, select: { moduleKey: true, canEdit: true } } },
  });
  if (!role) return err('Role not found', 404);

  // Privilege-escalation guard: only an ADMIN actor may grant an admin-capable
  // role (ADMIN type, or SETTINGS.canEdit which bypasses every RBAC check).
  // withPermission(SETTINGS.edit) alone would let a non-admin holding SETTINGS
  // edit add a second account and mint it a full administrator. Mirrors the same
  // guard in users/route.ts. Runs before the upsert, so it also covers the
  // reactivation path (which re-assigns roleId).
  if (roleGrantsSettingsEdit(role.roleType, role.permissions) && authActor(req).roleType !== 'ADMIN') {
    return err('Only an administrator can assign an admin-level role', 403);
  }

  const existing = await prisma.userOrganization.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
    select: { id: true, isActive: true },
  });
  if (existing?.isActive) return err('User is already a member', 409);

  const membership = existing
    ? await prisma.userOrganization.update({
        where: { id: existing.id },
        data: { isActive: true, roleId: parsed.data.roleId },
        select: { id: true },
      })
    : await prisma.userOrganization.create({
        data: { userId: user.id, organizationId: orgId, roleId: parsed.data.roleId, isActive: true },
        select: { id: true },
      });

  logAudit({
    orgId,
    actorId,
    entityType: 'UserOrganization',
    entityId: membership.id,
    action: existing ? 'UPDATE' : 'CREATE',
    payload: { userId: user.id, email, roleId: parsed.data.roleId, reactivated: Boolean(existing) },
  });
  return ok({ id: membership.id, userId: user.id, roleId: parsed.data.roleId, isActive: true }, 201);
});
