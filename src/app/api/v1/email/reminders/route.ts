import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler } from '@/lib/api-utils';
import { sendPaymentReminderEmail } from '@/lib/email';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);

  const invoices = await prisma.salesInvoice.findMany({
    where: { organizationId: orgId, status: 'OVERDUE' },
    include: {
      customer: { select: { name: true, email: true } },
      organization: { select: { displayName: true, emailFromName: true } },
    },
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const invoice of invoices) {
    if (!invoice.customer.email) continue;

    const daysOverdue = Math.floor(
      (Date.now() - invoice.dueDate!.getTime()) / 86400000,
    );

    try {
      await sendPaymentReminderEmail({
        to: invoice.customer.email,
        invoiceNumber: invoice.number,
        customerName: invoice.customer.name,
        amount: Number(invoice.totalAmount),
        daysOverdue,
        orgName: invoice.organization.displayName,
        emailFromName: invoice.organization.emailFromName,
      });
      sent++;
    } catch {
      failed++;
      errors.push(invoice.number);
    }
  }

  return ok({ sent, failed, errors });
});
