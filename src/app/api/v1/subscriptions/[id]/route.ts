import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const subscription = await (prisma as any).subscription.findFirst({
    where: { id, organizationId: orgId },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      plan: true,
    },
  });
  if (!subscription) throw new ApiError('Subscription not found', 404);

  return ok(subscription);
});

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;
  const body = await req.json();

  const existing = await (prisma as any).subscription.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new ApiError('Subscription not found', 404);

  const updated = await (prisma as any).subscription.update({
    where: { id },
    data: {
      ...(body.status !== undefined && { status: body.status }),
      ...(body.currentPeriodStart !== undefined && { currentPeriodStart: new Date(body.currentPeriodStart) }),
      ...(body.currentPeriodEnd !== undefined && { currentPeriodEnd: new Date(body.currentPeriodEnd) }),
      ...(body.nextInvoiceDate !== undefined && { nextInvoiceDate: new Date(body.nextInvoiceDate) }),
    },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      plan: true,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Subscription',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(updated);
});
