import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, withHandler, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) return err('Unauthenticated', 401);

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!po) return err('Purchase order not found', 404);
  if (po.status !== 'DRAFT') {
    return err(`Purchase order must be in DRAFT status to submit for approval (current: ${po.status})`, 400);
  }

  // Dedup: if an open PENDING request already exists (e.g. created by the
  // auto-route at finalize), reuse it rather than creating a duplicate.
  const existingPending = await prisma.approvalRequest.findFirst({
    where: { organizationId: orgId, documentType: 'PURCHASE_ORDER', documentId: id, status: 'PENDING' },
    select: { id: true },
  });
  if (existingPending) {
    // Already awaiting approval — ensure the doc reflects it and return the existing request.
    await prisma.purchaseOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL', updatedAt: new Date() } });
    return ok({ success: true, approvalRequestId: existingPending.id });
  }

  const [approvalRequest] = await prisma.$transaction([
    prisma.approvalRequest.create({
      data: {
        organizationId: orgId,
        documentType: 'PURCHASE_ORDER',
        documentId: id,
        requestedById: userId,
        requestedAt: new Date(),
        status: 'PENDING',
      },
    }),
    prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
    }),
  ]);

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'PurchaseOrder',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'submit-approval', approvalRequestId: approvalRequest.id },
  });

  return ok({ success: true, approvalRequestId: approvalRequest.id });
});
