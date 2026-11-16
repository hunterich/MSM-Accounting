// POST /api/v1/purchase-orders/[id]/reopen
// Reopens a closed PO (auto-closed or closed by hand) that still has an
// undelivered balance. Restricted to staff who can approve purchase orders.
// Auto-close, when enabled on the PO, restarts from the reopen date.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { reopenPurchaseOrder } from '@/lib/purchase-order-auto-close';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AP_POS', action: 'approve' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const actorId = req.headers.get('x-user-id');
  const updated = await prisma.$transaction((tx) => reopenPurchaseOrder(tx, orgId, id, actorId));
  return ok(updated);
});
