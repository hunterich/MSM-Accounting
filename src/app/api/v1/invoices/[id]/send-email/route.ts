import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { sendInvoiceEmail } from '@/lib/email';
import { routeForApproval } from '@/lib/approval/engine';
import { postInvoiceSend } from '@/lib/invoice-send-posting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AR_INVOICES', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);

  const body = await req.json().catch(() => ({}));
  const { to, cc, message } = body as { to?: string; cc?: string; message?: string };

  if (!to || !to.includes('@')) {
    throw new ApiError('Field "to" is required and must be a valid email address', 400);
  }

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, organizationId: orgId },
    include: {
      customer: true,
      organization: {
        select: { displayName: true, emailFromName: true },
      },
    },
  });
  if (!invoice) return err('Invoice not found', 404);

  const org = invoice.organization;

  try {
    await sendInvoiceEmail({
      to,
      cc,
      invoiceNumber: invoice.number,
      customerName: invoice.customer.name,
      amount: Number(invoice.totalAmount),
      dueDate: invoice.dueDate?.toISOString().split('T')[0] ?? '',
      orgName: org.displayName,
      emailFromName: org.emailFromName,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return err(message, 502);
  }

  if (invoice.status === 'DRAFT') {
    // Finalize DRAFT → SENT through the approval engine (same as the invoice
    // PUT route): if routed for approval, hold at PENDING_APPROVAL and post NO
    // GL; otherwise post the AR/COGS journal and mark SENT.
    // postInvoiceSend calls assertPeriodOpen internally, so the period guard
    // is covered.
    await prisma.$transaction(async (tx) => {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'INVOICE',
        documentId: id,
      });
      if (routed) {
        await tx.salesInvoice.update({
          where: { id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
      } else {
        await postInvoiceSend(tx, orgId, id);
        await tx.salesInvoice.update({
          where: { id },
          data: { status: 'SENT', updatedAt: new Date() },
        });
      }
    });
  }

  await prisma.salesInvoiceAuditLog.create({
    data: {
      invoiceId: id,
      action: 'EMAIL_SENT',
      actorId: userId,
      actorName: 'System',
      detail: { to, cc: cc ?? null },
    },
  });

  return ok({ success: true });
});
