// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, listResponse, logAudit, parsePaginationParams, withHandler } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const isActive = searchParams.get('isActive');
  const where: any = { organizationId: orgId, isActive: isActive ? isActive === 'true' : true };
  if (type) where.type = type;
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { sku: { contains: search, mode: 'insensitive' } },
  ];
  const [data, total] = await Promise.all([
    prisma.item.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' }, include: { category: { select: { id: true, name: true, code: true } } } }),
    prisma.item.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const { categoryId, purchaseUnit, purchaseConversionFactor, sellUnit, sellConversionFactor, ...rest } = body;
  const item = await prisma.item.create({
    data: {
      ...rest,
      organizationId: orgId,
      ...(categoryId && { categoryId }),
      ...(purchaseUnit && { purchaseUnit }),
      ...(purchaseConversionFactor != null && { purchaseConversionFactor }),
      ...(sellUnit && { sellUnit }),
      ...(sellConversionFactor != null && { sellConversionFactor }),
    },
    include: { category: { select: { id: true, name: true, code: true } } },
  });
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: item.id, action: 'CREATE', payload: { name: item.name } });
  return ok(item, 201);
}
