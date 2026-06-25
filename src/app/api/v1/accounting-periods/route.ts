import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  ApiError,
  err,
  listResponse,
  logAudit,
  ok,
  parsePaginationParams,
  withHandler,
} from '@/lib/api-utils';
import { accountingPeriodInputSchema } from '@/types/api';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

function normalizePeriodPayload(orgId: string, body: unknown) {
  const parsed = accountingPeriodInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid accounting period payload', 400);
  }

  return {
    ...parsed.data,
    startDate: new Date(parsed.data.startDate),
    endDate: new Date(parsed.data.endDate),
  };
}

async function ensureNoOverlap(orgId: string, startDate: Date, endDate: Date, excludeId?: string) {
  const overlapping = await prisma.accountingPeriod.findFirst({
    where: {
      organizationId: orgId,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, name: true },
  });

  if (overlapping) {
    throw new ApiError(`Accounting period overlaps with ${overlapping.name}`, 409);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.accountingPeriod.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { startDate: 'desc' },
    }),
    prisma.accountingPeriod.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const payload = normalizePeriodPayload(orgId, body);

  await ensureNoOverlap(orgId, payload.startDate, payload.endDate);

  const period = await prisma.accountingPeriod.create({
    data: payload,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AccountingPeriod',
    entityId: period.id,
    action: 'CREATE',
    payload: body,
  });

  return ok(period, 201);
});
