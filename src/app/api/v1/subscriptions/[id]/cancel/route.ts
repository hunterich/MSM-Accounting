import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { calculateProRataRefund } from '@/lib/subscription';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const subscription = await (prisma as any).subscription.findFirst({
    where: { id, organizationId: orgId },
    include: { plan: true },
  });
  if (!subscription) throw new ApiError('Subscription not found', 404);

  if (subscription.status === 'CANCELLED') {
    throw new ApiError('Subscription is already cancelled', 422);
  }

  const cancelDate = new Date();
  const { refundAmount, daysUsed, daysTotal } = calculateProRataRefund(
    subscription.plan,
    subscription,
    cancelDate,
  );
  const daysRemaining = daysTotal - daysUsed;

  await (prisma as any).subscription.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      cancelledAt: cancelDate,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Subscription',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'cancel', refundAmount, daysRemaining },
  });

  return ok({ refundAmount, daysRemaining, daysTotal });
});
