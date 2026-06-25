import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, err, ok, listResponse, nextNumber, logAudit, parsePaginationParams, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { stockCountCreateSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');
  const where: any = { organizationId: orgId, ...(status ? { status } : {}) };
  const [data, total] = await Promise.all([
    prisma.stockCount.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      include: { _count: { select: { lines: true } } },
    }),
    prisma.stockCount.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'INV_ADJ', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = stockCountCreateSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid stock count payload', 400);
  }
  const { date, warehouseId, categoryId, countedBy, notes } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    if (warehouseId) await validateForeignKey(tx.warehouse, { id: warehouseId, organizationId: orgId }, 'Warehouse not found in organization');
    if (categoryId) await validateForeignKey(tx.itemCategory, { id: categoryId, organizationId: orgId }, 'Category not found in organization');

    // Seed: in-scope active items + on-hand snapshot + cost.
    const items = await tx.item.findMany({
      where: { organizationId: orgId, isActive: true, type: 'PRODUCT', ...(categoryId ? { categoryId } : {}) },
      select: { id: true, costPrice: true },
      orderBy: { name: 'asc' },
    });
    const itemIds = items.map((i) => i.id);
    const lotRows = itemIds.length
      ? await tx.inventoryLot.groupBy({
          by: ['itemId'],
          // org-wide: cost layers are warehouse-agnostic; warehouseId is metadata
          where: { organizationId: orgId, itemId: { in: itemIds } },
          _sum: { qtyBalance: true },
        })
      : [];
    const onHand: Record<string, number> = {};
    for (const r of lotRows) onHand[r.itemId] = Number(r._sum.qtyBalance ?? 0);

    const number = await nextNumber(tx, 'StockCount', 'number', 'SC');
    const count = await tx.stockCount.create({
      data: {
        organizationId: orgId,
        number,
        date: new Date(date),
        status: 'DRAFT',
        warehouseId: warehouseId ?? null,
        categoryId: categoryId ?? null,
        countedBy: countedBy ?? null,
        notes: notes ?? null,
      },
    });
    if (items.length > 0) {
      await tx.stockCountLine.createMany({
        data: items.map((it, idx) => ({
          stockCountId: count.id,
          lineNo: idx + 1,
          itemId: it.id,
          systemQty: onHand[it.id] ?? 0,
          countedQty: null,
          unitCost: it.costPrice,
        })),
      });
    }
    return tx.stockCount.findUnique({
      where: { id: count.id },
      include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } }, orderBy: { lineNo: 'asc' } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockCount', entityId: result!.id, action: 'CREATE', payload: { number: result!.number } });
  return ok(result, 201);
});
