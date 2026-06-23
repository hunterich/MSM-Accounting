import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, logAudit } from '@/lib/api-utils';
import { ApiError } from '@/lib/errors';
import { postStockCount } from '@/lib/stock-count-posting';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id, organizationId: orgId },
        include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
      });
      if (!count) throw new ApiError('Stock count not found', 404);
      if (count.status !== 'SUBMITTED') throw new ApiError(`Cannot post a ${count.status} count`, 400);

      const generatedAdjustmentId = await postStockCount(tx, orgId, {
        id: count.id,
        number: count.number,
        date: count.date,
        warehouseId: count.warehouseId,
        lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
      });

      return tx.stockCount.update({
        where: { id },
        data: { status: 'POSTED', postedAt: new Date(), generatedAdjustmentId },
      });
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockCount', entityId: id, action: 'UPDATE', payload: { action: 'POST' } });
    return ok(result);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    return err('Failed to post stock count', 500);
  }
}
