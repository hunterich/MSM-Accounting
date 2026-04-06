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
import { positionInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parsePositionPayload(orgId: string, body: unknown) {
  const parsed = positionInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid position payload', 400);
  }

  return parsed.data;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');

  const where: any = { organizationId: orgId };
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.position.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    }),
    prisma.position.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const payload = parsePositionPayload(orgId, body);

  const position = await prisma.position.create({
    data: payload,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Position',
    entityId: position.id,
    action: 'CREATE',
    payload: body,
  });

  return ok(position, 201);
});
