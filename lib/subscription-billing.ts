import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/api-utils';
import { calculateNextPeriod } from '@/lib/subscription';
import { routeForApproval } from '@/lib/approval/engine';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { resolveRequesterId } from '@/lib/approval/requester';
import { nextInvoiceNumber } from '@/lib/invoice-number';
import { billingDay } from '@/lib/billing-calendar';

export async function runDueSubscriptions(orgId: string, actorId: string | null = null, today = new Date()) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
  const issueDate = billingDay(today, organization.timezone);
  // Find all subscriptions due for invoicing
  const subscriptions = await prisma.subscription.findMany({
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

  if (subscriptions.length === 0) return { generated: 0, invoices: [], errors: [] };
  const requesterId = await resolveRequesterId(orgId, actorId, 'subscription invoices');
  const errors: Array<{ subscriptionId: string; error: string }> = [];

  const invoices: { subscriptionId: string; invoiceId: string; invoiceNumber: string }[] = [];

  for (const sub of subscriptions) {
    // One transaction per subscription so a single failure (e.g. locked period)
    // rolls back only that subscription's work, not the whole batch.
    try {
      const created = await prisma.$transaction(async tx => {
      // Compute the advanced period up-front.
      const nextPeriod = calculateNextPeriod(sub.currentPeriodEnd, sub.plan.interval);
      const nextInvoiceDate = new Date(nextPeriod.end);
      nextInvoiceDate.setDate(nextInvoiceDate.getDate() - 7); // Invoice 7 days before period end

      // ── Atomic claim FIRST (before creating the invoice) ──────────────────
      // Advance the period as a guarded conditional update. Two concurrent batch
      // runs can both select this subscription (nextInvoiceDate <= today) before
      // either advances it; whichever runs this updateMany first flips
      // nextInvoiceDate forward, so the loser matches 0 rows and skips — no
      // duplicate invoice for the same period.
      const claim = await tx.subscription.updateMany({
        where: {
          id: sub.id,
          status: { in: ['ACTIVE', 'TRIALING'] },
          nextInvoiceDate: sub.nextInvoiceDate,
          currentPeriodEnd: sub.currentPeriodEnd,
        },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: nextPeriod.start,
          currentPeriodEnd: nextPeriod.end,
          nextInvoiceDate,
        },
      });
      if (claim.count !== 1) return; // another run already generated this period — skip (no invoice)

      const invoiceNumber = await nextInvoiceNumber(tx, orgId);

      const dueDate = new Date(sub.currentPeriodEnd);
      dueDate.setDate(dueDate.getDate() + 14); // Net 14

      const invoice = await tx.salesInvoice.create({
        data: {
          organizationId: orgId,
          number: invoiceNumber,
          customerId: sub.customerId,
          issueDate,
          dueDate,
          status: 'SENT',
          subtotal: Number(sub.plan.price),
          totalAmount: Number(sub.plan.price),
          taxAmount: 0,
          discountAmount: 0,
          currency: 'IDR',
          notes: `Subscription invoice for ${sub.plan.name} (${sub.currentPeriodStart.toISOString().slice(0, 10)} - ${sub.currentPeriodEnd.toISOString().slice(0, 10)})`,
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

      // Gate the live SENT invoice through the approval engine. A subscription
      // invoice is created SENT (live); if ar_invoices approval is required this
      // must instead be HELD (PENDING_APPROVAL) so it does not go live and skip
      // the gate.
      const routed = await routeForApproval(tx, {
        orgId,
        userId: requesterId,
        documentType: 'INVOICE',
        documentId: invoice.id,
      });
      if (routed) {
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
      } else {
        // Approval off / not required → the SENT invoice is live, so its GL must
        // actually post (AR/Sales/(tax)/COGS). Previously this route posted
        // NOTHING behind a live SENT invoice → revenue silently unrecorded.
        await postInvoiceSend(tx, orgId, invoice.id);
      }

      return { subscriptionId: sub.id, invoiceId: invoice.id, invoiceNumber: invoice.number };
      });
      if (created) invoices.push(created);
    } catch (error) {
      errors.push({ subscriptionId: sub.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  logAudit({
    orgId,
    actorId,
    entityType: 'Subscription',
    entityId: 'batch',
    action: 'CREATE',
    payload: { generated: invoices.length },
  });

  return { generated: invoices.length, invoices, errors };
}
