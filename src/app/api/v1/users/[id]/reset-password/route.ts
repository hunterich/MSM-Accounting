import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
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

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  // Org scoping: only reset users who belong to the caller's organization.
  const membership = await prisma.userOrganization.findFirst({
    where: { userId: targetUserId, organizationId: orgId },
    select: { id: true },
  });
  if (!membership) return err('User not found', 404);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: targetUserId },
    data: { passwordHash, mustChangePassword: true },
  });

  logAudit({
    orgId,
    actorId,
    entityType: 'User',
    entityId: targetUserId,
    action: 'RESET_PASSWORD',
    payload: { event: 'admin_reset' },
  });

  return ok({ success: true });
});
