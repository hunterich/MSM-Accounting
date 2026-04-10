import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { sendPurchaseOrderEmail } from '@/lib/email';

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

  const body = await req.json().catch(() => ({}));
  const { to, message } = body as { to?: string; message?: string };

  if (!to || !to.includes('@')) {
    throw new ApiError('Field "to" is required and must be a valid email address', 400);
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    include: {
      vendor: true,
      organization: {
        select: { displayName: true, emailFromName: true },
      },
    },
  });
  if (!po) return err('Purchase order not found', 404);

  const org = po.organization;

  try {
    await sendPurchaseOrderEmail({
      to,
      poNumber: po.number,
      vendorName: po.vendor.name,
      amount: Number(po.totalAmount),
      orgName: org.displayName,
      emailFromName: org.emailFromName,
      message,
      expectedDate: po.expectedDate?.toISOString().split('T')[0],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return err(message, 502);
  }

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'PurchaseOrder',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'email_sent', to },
  });

  return ok({ success: true });
});
