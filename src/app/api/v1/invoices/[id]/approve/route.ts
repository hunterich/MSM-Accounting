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

  if (req.headers.get('x-role-type') !== 'ADMIN') {
    return err('Forbidden: ADMIN role required', 403);
  }

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!invoice) return err('Invoice not found', 404);
  if (invoice.status !== 'PENDING_APPROVAL') {
    return err(`Invoice must be in PENDING_APPROVAL status to approve (current: ${invoice.status})`, 400);
  }

  const approvalRequest = await prisma.approvalRequest.findFirst({
    where: {
      organizationId: orgId,
      documentType: 'INVOICE',
      documentId: id,
      status: 'PENDING',
    },
    orderBy: { requestedAt: 'desc' },
    select: { id: true },
  });
  if (!approvalRequest) return err('No pending approval request found for this invoice', 404);

  const now = new Date();
  await prisma.$transaction([
    prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: {
        status: 'APPROVED',
        reviewedById: userId,
        reviewedAt: now,
      },
    }),
    prisma.salesInvoice.update({
      where: { id },
      data: { status: 'SENT', updatedAt: now },
    }),
  ]);

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'SalesInvoice',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'approve', approvalRequestId: approvalRequest.id },
  });

  return ok({ success: true });
});
