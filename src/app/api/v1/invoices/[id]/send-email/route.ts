import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { sendInvoiceEmail } from '@/lib/email';

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
  const userId = req.headers.get('x-user-id');

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
    await prisma.salesInvoice.update({
      where: { id },
      data: { status: 'SENT' },
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
