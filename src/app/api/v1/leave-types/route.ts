import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, listResponse, parsePaginationParams, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { leaveTypeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { page, limit } = parsePaginationParams(req, { limit: 50 });

  const where: any = { organizationId: orgId };

  const [data, total] = await Promise.all([
    prisma.leaveType.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.leaveType.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'HR_ATTENDANCE', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = leaveTypeInputSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) return ok({ error: parsed.error.issues[0]?.message }, 400);

  const created = await prisma.leaveType.create({
    data: {
      organizationId: orgId,
      name: parsed.data.name,
      category: parsed.data.category,
      entitlementDays: parsed.data.entitlementDays,
      carryOver: parsed.data.carryOver,
      maxCarryDays: parsed.data.maxCarryDays,
      isActive: parsed.data.isActive,
    },
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveType', entityId: created.id, action: 'CREATE', payload: { name: created.name } });
  return ok(created, 201);
});
