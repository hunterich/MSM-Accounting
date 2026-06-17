// POST /api/v1/bills/[id]/unreceive
// Reverses a draft goods-receipt bill: removes cost layers, posts the GL contra,
// rolls back the PO's receivedQty + status, and soft-deletes the receipt bill.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { unreceiveGoodsReceipt } from '@/lib/unreceive-goods';

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

  await prisma.$transaction(async (tx) => {
    await unreceiveGoodsReceipt(tx, orgId, id, { date });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'DELETE', payload: { reason: 'unreceive' } });
  return ok({ unreceived: true, billId: id });
});
