import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, listResponse, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id')!;
  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, Number(searchParams.get('page')  ?? 1));
  const limit = Math.min(200, Number(searchParams.get('limit') ?? 200));
  const where = { organizationId: orgId };
  const [data, total] = await Promise.all([
    prisma.itemCategory.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
    prisma.itemCategory.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id')!;
  const body  = await req.json();
  const category = await prisma.itemCategory.create({
    data: {
      name:        body.name,
      code:        (body.code as string).toUpperCase(),
      description: body.description ?? null,
      isActive:    body.isActive !== false,
      organizationId: orgId,
    },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ItemCategory', entityId: category.id, action: 'CREATE', payload: { name: category.name } });
  return ok(category, 201);
}
