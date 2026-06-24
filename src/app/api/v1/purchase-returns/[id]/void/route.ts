// POST /api/v1/purchase-returns/[id]/void
// Reverses a posted purchase return's inventory journal entry, restores the
// stock it removed, and marks it VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidPurchaseReturn } from '@/lib/return-void';

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

  const purchaseReturn = await prisma.$transaction(async (tx) => {
    await voidPurchaseReturn(tx, orgId, id, { date });
    return tx.purchaseReturn.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: { select: { id: true, name: true, code: true } }, lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseReturn', entityId: id, action: 'VOID', payload: null });
  return ok(purchaseReturn);
});
