// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, ok, listResponse, logAudit, parsePaginationParams, validateForeignKey, withHandler } from '@/lib/api-utils';
import { createItemInputSchema } from '@/types/api';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';

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
  const itemIds = data.map((i) => i.id);
  const stockAgg = itemIds.length
    ? await prisma.inventoryLot.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds } },
        _sum: { qtyBalance: true },
      })
    : [];
  const stockMap = new Map(stockAgg.map((r) => [r.itemId, Number(r._sum.qtyBalance ?? 0)]));
  const enriched = data.map((i) => ({ ...i, currentStock: stockMap.get(i.id) ?? 0 }));
  return listResponse(enriched, total, page, limit);
});

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const parsed = createItemInputSchema.safeParse({
    ...body,
    type: typeof body.type === 'string' ? String(body.type).trim().toUpperCase().replace(/[\s-]+/g, '_') : body.type,
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid item payload', 400);

  if (parsed.data.categoryId) {
    await validateForeignKey(prisma.itemCategory, { id: parsed.data.categoryId, organizationId: orgId, isActive: true }, 'Item category not found in organization');
  }
  if (parsed.data.inventoryAccountId) {
    await validateForeignKey(prisma.account, { id: parsed.data.inventoryAccountId, organizationId: orgId, isActive: true }, 'Inventory account not found in organization');
  }
  if (parsed.data.revenueAccountId) {
    await validateForeignKey(prisma.account, { id: parsed.data.revenueAccountId, organizationId: orgId, isActive: true }, 'Revenue account not found in organization');
  }
  if (parsed.data.cogsAccountId) {
    await validateForeignKey(prisma.account, { id: parsed.data.cogsAccountId, organizationId: orgId, isActive: true }, 'COGS account not found in organization');
  }

  const itemData: Record<string, unknown> = {
    organizationId: orgId,
    sku: parsed.data.sku,
    name: parsed.data.name,
    type: parsed.data.type,
    unit: parsed.data.unit,
    openingStock: parsed.data.openingStock,
    reorderPoint: parsed.data.reorderPoint,
    isActive: parsed.data.isActive,
  };

  if (parsed.data.categoryId !== undefined) itemData.categoryId = parsed.data.categoryId || null;
  if (parsed.data.purchaseUnit !== undefined) itemData.purchaseUnit = parsed.data.purchaseUnit || null;
  if (parsed.data.purchaseConversionFactor !== undefined) itemData.purchaseConversionFactor = parsed.data.purchaseConversionFactor;
  if (parsed.data.sellUnit !== undefined) itemData.sellUnit = parsed.data.sellUnit || null;
  if (parsed.data.sellConversionFactor !== undefined) itemData.sellConversionFactor = parsed.data.sellConversionFactor;
  if (parsed.data.barcode !== undefined) itemData.barcode = parsed.data.barcode?.trim() || null;
  if (parsed.data.description !== undefined) itemData.description = parsed.data.description?.trim() || null;
  if (parsed.data.weight !== undefined) itemData.weight = parsed.data.weight;
  if (parsed.data.cost !== undefined || parsed.data.costPrice !== undefined) itemData.costPrice = parsed.data.costPrice ?? parsed.data.cost;
  if (parsed.data.price !== undefined || parsed.data.sellingPrice !== undefined) itemData.sellingPrice = parsed.data.sellingPrice ?? parsed.data.price;
  if (parsed.data.inventoryAccountId !== undefined) itemData.inventoryAccountId = parsed.data.inventoryAccountId || null;
  if (parsed.data.revenueAccountId !== undefined) itemData.revenueAccountId = parsed.data.revenueAccountId || null;
  if (parsed.data.cogsAccountId !== undefined) itemData.cogsAccountId = parsed.data.cogsAccountId || null;

  let item;
  try {
    item = await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: itemData,
        include: { category: { select: { id: true, name: true, code: true } } },
      });
      // Post opening stock as a real cost layer + opening journal entry so the
      // inventory asset and on-hand quantity agree from day one.
      await postOpeningStockIfNeeded(tx, orgId, created.id, new Date());
      return created;
    });
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    throw error;
  }
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: item.id, action: 'CREATE', payload: { name: item.name } });
  return ok(item, 201);
}
