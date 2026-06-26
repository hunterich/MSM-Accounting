import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, listResponse, parsePaginationParams, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { page, limit } = parsePaginationParams(req);

  const where: any = { organizationId: orgId };

  const [data, total] = await Promise.all([
    (prisma as any).subscriptionPlan.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    (prisma as any).subscriptionPlan.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  if (!body.name || body.price === undefined || !body.interval) {
    return err('name, price, and interval are required', 400);
  }

  const plan = await (prisma as any).subscriptionPlan.create({
    data: {
      organizationId: orgId,
      name: body.name,
      price: body.price,
      interval: body.interval,
      trialDays: body.trialDays ?? 0,
      features: body.features ? JSON.stringify(body.features) : '[]',
      isActive: body.isActive ?? true,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SubscriptionPlan',
    entityId: plan.id,
    action: 'CREATE',
    payload: { name: plan.name },
  });

  return ok(plan, 201);
});
