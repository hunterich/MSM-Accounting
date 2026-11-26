import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAuditTx, ApiError } from '@/lib/api-utils';
import { withPermission, authActor } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { hashPassword, passwordSchema } from '@/lib/password';

export const runtime = 'nodejs';

const bodySchema = z.object({ newPassword: passwordSchema });

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'SETTINGS', action: 'edit' },
  async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
  const { orgId, userId: actorId } = requireAuth(req);
  const { id: targetUserId } = await params;
  if (authActor(req).roleType !== 'ADMIN') return err('Only an administrator can reset passwords', 403);
  if (targetUserId === actorId) return err('Use the change password option for your own account', 400);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction(async (tx) => {
    // Lock the parent user row so concurrent new memberships cannot be inserted
    // between checking membership scope and changing global credentials.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetUserId} FOR UPDATE`;
    const memberships = await tx.userOrganization.findMany({
      where: { userId: targetUserId },
      select: { organizationId: true, isActive: true },
    });
    if (!memberships.some(m => m.organizationId === orgId && m.isActive)) throw new ApiError('User not found', 404);
    // Include inactive memberships: they can later be reactivated.
    if (memberships.some(m => m.organizationId !== orgId)) {
      throw new ApiError('A shared account cannot be reset by a company administrator', 403);
    }
    await tx.user.update({
      where: { id: targetUserId },
      data: { passwordHash, mustChangePassword: true },
    });
    await logAuditTx(tx, {
      orgId, actorId, entityType: 'User', entityId: targetUserId,
      action: 'RESET_PASSWORD', payload: { event: 'admin_reset' },
    });
  });

  return ok({ success: true });
});
