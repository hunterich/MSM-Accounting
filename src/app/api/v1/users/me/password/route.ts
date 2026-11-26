import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, withHandler, requireAuth, logAuditTx, ApiError } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { hashPassword, comparePassword, passwordSchema } from '@/lib/password';
import { COOKIE_NAME, credentialStamp, signToken, verifyToken } from '@/lib/auth';

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
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session || session.userId !== userId || session.credentialStamp !== credentialStamp(user.passwordHash)) {
    return err('Session expired; sign in again', 401);
  }
  await prisma.$transaction(async tx => {
    const updated = await tx.user.updateMany({
      where: { id: userId, passwordHash: user.passwordHash },
      data: { passwordHash, mustChangePassword: false },
    });
    if (updated.count !== 1) throw new ApiError('Password changed; sign in again', 409);
    await logAuditTx(tx, {
      orgId, actorId: userId, entityType: 'User', entityId: userId,
      action: 'CHANGE_PASSWORD', payload: { event: 'self_change' },
    });
  });
  const response = ok({ success: true });
  const fresh = await signToken({ ...session, credentialStamp: credentialStamp(passwordHash) });
  response.cookies.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',
  });
  return response;
});
