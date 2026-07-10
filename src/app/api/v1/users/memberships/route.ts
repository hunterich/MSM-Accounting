import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';

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

  // The role must belong to THIS org (cross-org guard). validateForeignKey
  // throws ApiError(404) → surfaced as 404 by withHandler; nothing is created.
  await validateForeignKey(prisma.role, { id: parsed.data.roleId, organizationId: orgId }, 'Role not found');

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
