import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, withHandler, requireAuth, logAudit } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { hashPassword, comparePassword, passwordSchema } from '@/lib/password';

export const runtime = 'nodejs';

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const { orgId, userId } = requireAuth(req);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user || !user.passwordHash) return err('User not found', 404);

  const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return err('Current password is incorrect', 400);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'User',
    entityId: userId,
    action: 'CHANGE_PASSWORD',
    payload: { event: 'self_change' },
  });

  return ok({ success: true });
});
