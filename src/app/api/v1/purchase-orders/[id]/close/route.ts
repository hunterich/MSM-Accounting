// POST /api/v1/purchase-orders/[id]/close
// Manual close — sets status=CLOSED regardless of receivedQty
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { lockPurchaseOrder } from '@/lib/purchase-order-auto-close';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AP_POS', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orgId = requireOrg(req);

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, number: true },
  });
  if (!po) return err('Purchase order not found', 404);
  if (po.status === 'CANCELLED') return err('Cannot close a cancelled PO', 422);
  if (po.status === 'CLOSED') return err('PO is already closed', 422);

  const updated = await prisma.$transaction(async (tx) => {
    await lockPurchaseOrder(tx, id);
    const current = await tx.purchaseOrder.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
    if (!current || ['CLOSED', 'CANCELLED'].includes(current.status)) throw new ApiError('PO is already closed or cancelled', 422);
    return tx.purchaseOrder.update({
      where: { id, organizationId: orgId },
      data: { status: 'CLOSED' },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseOrder', entityId: id, action: 'UPDATE', payload: { action: 'manual_close' } });
  return ok(updated);
});
