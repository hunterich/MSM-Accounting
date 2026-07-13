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
} from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { salesTypeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseSalesTypePayload(orgId: string, body: unknown) {
  const parsed = salesTypeInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid sales type payload', 400);
  }

  return parsed.data;
}

async function assertChargeAccountOwned(orgId: string, chargeAccountId: string | null | undefined) {
  if (!chargeAccountId) return;

  const account = await prisma.account.findFirst({
    where: { id: chargeAccountId, organizationId: orgId },
    select: { id: true },
  });

  if (!account) {
    throw new ApiError('Selected charge account was not found', 400);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');

  const where: any = { organizationId: orgId };
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.salesType.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.salesType.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'POS_RETAIL', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const parsed = parseSalesTypePayload(orgId, body);

  await assertChargeAccountOwned(orgId, parsed.chargeAccountId);

  const created = await prisma.salesType.create({
    data: {
      organizationId: orgId,
      name: parsed.name,
      channel: parsed.channel,
      serviceChargePct: parsed.serviceChargePct,
      chargeAccountId: parsed.chargeAccountId ?? null,
      taxable: parsed.taxable,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SalesType',
    entityId: created.id,
    action: 'CREATE',
    payload: body,
  });

  return ok(created, 201);
});
