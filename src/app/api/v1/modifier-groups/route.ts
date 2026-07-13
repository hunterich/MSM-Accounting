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
import { modifierGroupInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseModifierGroupPayload(orgId: string, body: unknown) {
  const parsed = modifierGroupInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid modifier group payload', 400);
  }

  return parsed.data;
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
    prisma.modifierGroup.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        _count: { select: { attachments: true } },
      },
    }),
    prisma.modifierGroup.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'POS_RETAIL', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const parsed = parseModifierGroupPayload(orgId, body);

  const created = await prisma.modifierGroup.create({
    data: {
      organizationId: orgId,
      name: parsed.name,
      selectionType: parsed.selectionType,
      isRequired: parsed.isRequired,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
      options: {
        create: parsed.options.map((o) => ({
          name: o.name,
          priceDelta: o.priceDelta,
          itemId: o.itemId ?? null,
          sortOrder: o.sortOrder,
          isActive: o.isActive,
        })),
      },
    },
    include: { options: true },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'ModifierGroup',
    entityId: created.id,
    action: 'CREATE',
    payload: body,
  });

  return ok(created, 201);
});
