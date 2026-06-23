import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';
import { ApiError } from '@/lib/errors';
import { stockCountUpdateSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({
    where: { id, organizationId: orgId },
    include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } }, orderBy: { lineNo: 'asc' } } },
  });
  if (!count) return err('Stock count not found', 404);

  // Live on-hand per line, for the "changed since count" flag.
  const itemIds = count.lines.map((l) => l.itemId);
  const lotRows = itemIds.length
    ? await prisma.inventoryLot.groupBy({ by: ['itemId'], where: { organizationId: orgId, itemId: { in: itemIds } }, _sum: { qtyBalance: true } })
    : [];
  const live: Record<string, number> = {};
  for (const r of lotRows) live[r.itemId] = Number(r._sum.qtyBalance ?? 0);
  const lines = count.lines.map((l) => {
    const liveQty = live[l.itemId] ?? 0;
    return { ...l, liveSystemQty: liveQty, changedSinceCount: liveQty !== Number(l.systemQty) };
  });

  return ok({ ...count, lines });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const body = await req.json();
  const parsed = stockCountUpdateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  const { notes, countedBy, lines } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockCount.findFirst({ where: { id, organizationId: orgId }, include: { lines: true } });
      if (!existing) throw new ApiError('Stock count not found', 404);
      if (existing.status !== 'DRAFT') throw new ApiError('Only DRAFT counts can be edited', 400);

      await tx.stockCount.update({
        where: { id },
        data: { ...(notes !== undefined ? { notes } : {}), ...(countedBy !== undefined ? { countedBy } : {}) },
      });

      if (lines) {
        const byItem = new Map(existing.lines.map((l) => [l.itemId, l]));
        const keepItemIds = new Set(lines.map((l) => l.itemId));
        // Update existing / add new (＋Add item)
        let maxLineNo = existing.lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
        for (const l of lines) {
          const found = byItem.get(l.itemId);
          const countedQty = l.countedQty === undefined ? (found ? found.countedQty : null) : l.countedQty;
          if (found) {
            await tx.stockCountLine.update({ where: { id: found.id }, data: { countedQty, note: l.note ?? null } });
          } else {
            const item = await tx.item.findFirst({ where: { id: l.itemId, organizationId: orgId, isActive: true }, select: { id: true, costPrice: true } });
            if (!item) throw new ApiError('Item not found in organization', 404);
            const lotAgg = await tx.inventoryLot.aggregate({ where: { organizationId: orgId, itemId: l.itemId }, _sum: { qtyBalance: true } });
            await tx.stockCountLine.create({
              data: { stockCountId: id, lineNo: ++maxLineNo, itemId: l.itemId, systemQty: Number(lotAgg._sum.qtyBalance ?? 0), countedQty, unitCost: item.costPrice, note: l.note ?? null },
            });
          }
        }
        // Remove lines no longer present (de-selected from the worksheet)
        const toDelete = existing.lines.filter((l) => !keepItemIds.has(l.itemId)).map((l) => l.id);
        if (toDelete.length) await tx.stockCountLine.deleteMany({ where: { id: { in: toDelete } } });
      }

      return tx.stockCount.findUnique({
        where: { id },
        include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } }, orderBy: { lineNo: 'asc' } } },
      });
    });
    return ok(result);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    return err('Failed to update stock count', 500);
  }
}
