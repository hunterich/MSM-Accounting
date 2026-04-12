import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const plan = await (prisma as any).subscriptionPlan.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!plan) throw new ApiError('Plan not found', 404);

  return ok(plan);
});

export const PUT = withHandler(async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;
  const body = await req.json();

  const existing = await (prisma as any).subscriptionPlan.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new ApiError('Plan not found', 404);

  const updated = await (prisma as any).subscriptionPlan.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.price !== undefined && { price: body.price }),
      ...(body.interval !== undefined && { interval: body.interval }),
      ...(body.trialDays !== undefined && { trialDays: body.trialDays }),
      ...(body.features !== undefined && { features: JSON.stringify(body.features) }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SubscriptionPlan',
    entityId: id,
    action: 'UPDATE',
    payload: { name: updated.name },
  });

  return ok(updated);
});

export const DELETE = withHandler(async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const existing = await (prisma as any).subscriptionPlan.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new ApiError('Plan not found', 404);

  // Check if any active subscriptions use this plan
  const activeSubs = await (prisma as any).subscription.count({
    where: { planId: id, status: { not: 'CANCELLED' } },
  });
  if (activeSubs > 0) {
    return err(`Cannot delete plan with ${activeSubs} active subscription(s)`, 422);
  }

  await (prisma as any).subscriptionPlan.delete({ where: { id } });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SubscriptionPlan',
    entityId: id,
    action: 'DELETE',
    payload: { name: existing.name },
  });

  return ok({ deleted: true });
});
