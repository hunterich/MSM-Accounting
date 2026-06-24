// POST /api/v1/stock-adjustments/[id]/void
// Reverses a posted stock adjustment's variance journal entry, unwinds the
// inventory it moved (removes increases, restores decreases), and marks it VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidStockAdjustment } from '@/lib/stock-adjustment-void';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const adjustment = await prisma.$transaction(async (tx) => {
    await voidStockAdjustment(tx, orgId, id, { date });
    return tx.stockAdjustment.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: id, action: 'VOID', payload: null });
  return ok(adjustment);
});
