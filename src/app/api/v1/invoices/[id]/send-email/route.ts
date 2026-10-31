import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { sendInvoiceEmail } from '@/lib/email';
import { routeForApproval } from '@/lib/approval/engine';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { buildPdfAttachment, PdfAttachmentError } from '@/lib/pdf-attachment';

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

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);

  const body = await req.json().catch(() => ({}));
  const { to, cc, message, pdfBase64, pdfName } = body as {
    to?: string; cc?: string; message?: string; pdfBase64?: string; pdfName?: string;
  };

  if (!to || !to.includes('@')) {
    throw new ApiError('Field "to" is required and must be a valid email address', 400);
  }
  if (cc && !cc.includes('@')) {
    throw new ApiError('Field "cc" must be a valid email address', 400);
  }
  if (message && message.length > 2000) {
    throw new ApiError('Message is too long (max 2000 characters)', 400);
  }

  // The browser renders the PDF from the print preview; the server only checks it.
  let attachment: ReturnType<typeof buildPdfAttachment> | null = null;
  if (pdfBase64) {
    try {
      attachment = buildPdfAttachment(pdfBase64, pdfName, 'invoice');
    } catch (e) {
      if (e instanceof PdfAttachmentError) throw new ApiError(e.message, 400);
      throw e;
    }
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

  // Respect the approval state: a held invoice is not released to the customer
  // until it is approved, and a voided one must never be sent.
  if (invoice.status === 'VOID') return err('A voided invoice cannot be emailed', 422);
  if (invoice.status === 'PENDING_APPROVAL') return err('This invoice is awaiting approval and cannot be emailed yet', 422);

  const org = invoice.organization;

  if (invoice.status === 'DRAFT') {
    // Finalize DRAFT → SENT through the approval engine (same as the invoice
    // PUT route) BEFORE anything is emailed: if the invoice is routed for
    // approval it is held at PENDING_APPROVAL with NO GL posting, and must not
    // reach the customer. Otherwise post the AR/COGS journal and mark SENT.
    // postInvoiceSend calls assertPeriodOpen internally, so the period guard
    // is covered.
    const held = await prisma.$transaction(async (tx) => {
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
        return true;
      }
      await postInvoiceSend(tx, orgId, id, dateOverride);
      await tx.salesInvoice.update({
        where: { id },
        data: { status: 'SENT', updatedAt: new Date() },
      });
      return false;
    });
    if (held) {
      return err('This invoice was submitted for approval and has not been emailed. Send it again once it is approved.', 409);
    }
  }

  try {
    await sendInvoiceEmail({
      orgId,
      to,
      cc,
      invoiceNumber: invoice.number,
      customerName: invoice.customer.name,
      amount: Number(invoice.totalAmount),
      dueDate: invoice.dueDate?.toISOString().split('T')[0] ?? '',
      orgName: org.displayName,
      emailFromName: org.emailFromName,
      message,
      ...(attachment ? { attachments: [attachment] } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return err(message, 502);
  }

  await prisma.salesInvoiceAuditLog.create({
    data: {
      invoiceId: id,
      action: 'EMAIL_SENT',
      actorId: userId,
      actorName: 'System',
      detail: { to, cc: cc ?? null, pdfAttached: Boolean(attachment) },
    },
  });

  return ok({ success: true });
});
