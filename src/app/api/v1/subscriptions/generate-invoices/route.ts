import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { calculateNextPeriod } from '@/lib/subscription';
import { routeForApproval } from '@/lib/approval/engine';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { resolveRequesterId } from '@/lib/approval/requester';
import { nextInvoiceNumber } from '@/lib/invoice-number';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const actorId = req.headers.get('x-user-id');
  // Resolve the user any held ApprovalRequest will be attributed to: the caller
  // (x-user-id) when present, else the org's admin (deterministic scheduler
  // fallback). Resolved up-front so every subscription in the batch shares it,
  // and so the batch refuses (401) rather than routing with a null requester.
  const requesterId = await resolveRequesterId(orgId, actorId, 'subscription invoices');

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
    // One transaction per subscription so a single failure (e.g. locked period)
    // rolls back only that subscription's work, not the whole batch.
    await prisma.$transaction(async (tx: any) => {
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
          nextInvoiceDate: { lte: today },
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

      invoices.push({
        subscriptionId: sub.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
      });
    });
  }

  logAudit({
    orgId,
    actorId,
    entityType: 'Subscription',
    entityId: 'batch',
    action: 'CREATE',
    payload: { generated: invoices.length },
  });

  return ok({ generated: invoices.length, invoices });
});
