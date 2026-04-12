import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit, nextNumber } from '@/lib/api-utils';
import { calculateNextPeriod } from '@/lib/subscription';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const today = new Date();

  // Find all subscriptions due for invoicing
  const subscriptions = await (prisma as any).subscription.findMany({
    where: {
      organizationId: orgId,
      status: { in: ['ACTIVE', 'TRIALING'] },
      nextInvoiceDate: { lte: today },
    },
    include: {
      plan: true,
      customer: { select: { id: true, name: true } },
    },
  });

  if (subscriptions.length === 0) {
    return ok({ generated: 0, invoices: [] });
  }

  const invoices: { subscriptionId: string; invoiceId: string; invoiceNumber: string }[] = [];

  for (const sub of subscriptions) {
    await prisma.$transaction(async (tx: any) => {
      const invoiceNumber = await nextNumber(tx, 'SalesInvoice', 'number', 'INV');

      const dueDate = new Date(sub.currentPeriodEnd);
      dueDate.setDate(dueDate.getDate() + 14); // Net 14

      const invoice = await tx.salesInvoice.create({
        data: {
          organizationId: orgId,
          number: invoiceNumber,
          customerId: sub.customerId,
          issueDate: today,
          dueDate,
          status: 'SENT',
          subtotal: Number(sub.plan.price),
          totalAmount: Number(sub.plan.price),
          taxAmount: 0,
          discountAmount: 0,
          currency: 'IDR',
          notes: `Subscription invoice for ${sub.plan.name} (${sub.currentPeriodStart.toISOString().slice(0, 10)} - ${sub.currentPeriodEnd.toISOString().slice(0, 10)})`,
          recurringInvoiceId: sub.recurringInvoiceId ?? undefined,
          lines: {
            create: [
              {
                lineNo: 1,
                description: `${sub.plan.name} - ${sub.plan.interval} subscription`,
                quantity: 1,
                unit: 'SUB',
                price: Number(sub.plan.price),
                lineSubtotal: Number(sub.plan.price),
                discountPct: 0,
              },
            ],
          },
        },
      });

      // Advance subscription period
      const nextPeriod = calculateNextPeriod(sub.currentPeriodEnd, sub.plan.interval);
      const nextInvoiceDate = new Date(nextPeriod.end);
      nextInvoiceDate.setDate(nextInvoiceDate.getDate() - 7); // Invoice 7 days before period end

      await (tx as any).subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: nextPeriod.start,
          currentPeriodEnd: nextPeriod.end,
          nextInvoiceDate,
        },
      });

      invoices.push({
        subscriptionId: sub.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
      });
    });
  }

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Subscription',
    entityId: 'batch',
    action: 'CREATE',
    payload: { generated: invoices.length },
  });

  return ok({ generated: invoices.length, invoices });
});
