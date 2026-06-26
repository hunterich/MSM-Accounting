import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { ApiError } from '@/lib/errors';
import { postStockCount } from '@/lib/stock-count-posting';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withPermission({ module: 'INV_ADJ', action: 'create' }, async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await params;
  const result = await prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
    });
    if (!count) throw new ApiError('Stock count not found', 404);
    if (count.status !== 'SUBMITTED') throw new ApiError(`Cannot post a ${count.status} count`, 400);

    // Atomically claim POSTED before the inventory/GL side effect. The guarded
    // updateMany takes a row lock; a concurrent post blocks here, then sees the
    // row already POSTED → count 0 → 409. This is the race guard — it MUST run
    // before postStockCount, or two concurrent posts both create a
    // StockAdjustment + double the inventory + double the variance JE.
    const claim = await tx.stockCount.updateMany({
      where: { id, organizationId: orgId, status: 'SUBMITTED' },
      data: { status: 'POSTED', postedAt: new Date() },
    });
    if (claim.count !== 1) throw new ApiError('Stock count already posted', 409);

    const generatedAdjustmentId = await postStockCount(tx, orgId, {
      id: count.id, number: count.number, date: count.date, warehouseId: count.warehouseId,
      lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
    });
    // Attach the generated adjustment id (status/postedAt were set by the claim).
    return tx.stockCount.update({ where: { id }, data: { generatedAdjustmentId } });
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockCount', entityId: id, action: 'UPDATE', payload: { action: 'POST' } });
  return ok(result);
});
