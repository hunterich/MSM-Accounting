import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, listResponse, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { itemCategoryInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id')!;
  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, Number(searchParams.get('page')  ?? 1));
  const limit = Math.min(200, Number(searchParams.get('limit') ?? 200));
  const isActive = searchParams.get('isActive');
  const where = { organizationId: orgId, isActive: isActive ? isActive === 'true' : true };
  const [data, total] = await Promise.all([
    prisma.itemCategory.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
    prisma.itemCategory.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
}

export const POST = withPermission({ module: 'INV_CATEGORIES', action: 'create' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id')!;
  const body  = await req.json();
  const parsed = itemCategoryInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid item category payload', 400);
  const category = await prisma.itemCategory.create({
    data: {
      name:        parsed.data.name,
      code:        parsed.data.code.trim().toUpperCase(),
      description: parsed.data.description?.trim() || null,
      isActive:    parsed.data.isActive,
      organizationId: orgId,
    },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ItemCategory', entityId: category.id, action: 'CREATE', payload: { name: category.name } });
  return ok(category, 201);
});
