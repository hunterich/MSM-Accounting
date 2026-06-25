import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, listResponse, parsePaginationParams, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { calculateTrialEndDate, calculateNextPeriod, type BillingInterval } from '@/lib/subscription';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req);
  const customerId = searchParams.get('customerId');
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    (prisma as any).subscription.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        plan: true,
      },
    }),
    (prisma as any).subscription.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  if (!body.customerId || !body.planId) {
    return err('customerId and planId are required', 400);
  }

  const plan = await (prisma as any).subscriptionPlan.findFirst({
    where: { id: body.planId, organizationId: orgId },
  });
  if (!plan) throw new ApiError('Plan not found', 404);

  const customer = await prisma.customer.findFirst({
    where: { id: body.customerId, organizationId: orgId },
  });
  if (!customer) throw new ApiError('Customer not found', 404);

  const startDate = body.startDate ? new Date(body.startDate) : new Date();
  const trialDays = plan.trialDays ?? 0;
  const trialEndDate = trialDays > 0 ? calculateTrialEndDate(startDate, trialDays) : null;

  // Calculate initial period using the shared helper so interval logic is DRY.
  // Subtract one day from startDate so calculateNextPeriod (which adds 1 day to
  // derive the period start) lands back on startDate exactly.
  const fakePreviousEnd = new Date(startDate);
  fakePreviousEnd.setDate(fakePreviousEnd.getDate() - 1);
  const initialPeriod = calculateNextPeriod(fakePreviousEnd, plan.interval as BillingInterval);
  const periodEnd = initialPeriod.end;

  const subscription = await (prisma as any).subscription.create({
    data: {
      organizationId: orgId,
      customerId: body.customerId,
      planId: body.planId,
      status: trialDays > 0 ? 'TRIALING' : 'ACTIVE',
      startDate,
      trialEndDate,
      currentPeriodStart: startDate,
      currentPeriodEnd: periodEnd,
      nextInvoiceDate: trialEndDate || startDate,
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
    entityId: subscription.id,
    action: 'CREATE',
    payload: { customerId: body.customerId, planId: body.planId },
  });

  return ok(subscription, 201);
});
