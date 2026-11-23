import { recurringInvoiceAmounts } from '@/lib/recurring-document-totals';
import { advisoryLockKey } from '@/lib/advisory-lock';
import { nextRecurringDate } from '@/lib/billing-calendar';
import { nextInvoiceNumber } from '@/lib/invoice-number';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  ApiError,
  ok,
  requireOrg,
  withHandler,
  logAudit,
} from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { routeForApproval } from '@/lib/approval/engine';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { assertItemsActive } from '@/lib/item-availability';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Route ───────────────────────────────────────────────────────────────────

export const POST = withPermission({ module: 'AR_INVOICES', action: 'create' }, async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const orgId = requireOrg(req);
  // Manual "Generate now": a user clicked the button, so we require their id —
  // it becomes the ApprovalRequest.requestedById (a required FK) when the
  // auto-posted invoice is held for approval. Refuse rather than route with a
  // null requester, which would either crash on the FK or reintroduce a bypass.
  const userId = req.headers.get('x-user-id');
  if (!userId) throw new ApiError('Unauthenticated', 401);
  const { id } = await ctx.params;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey('recurring-invoice:' + id)})`;
    // 1. Load template with lines and customer
    const template = await tx.recurringInvoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        customer: { select: { id: true, name: true } },
        lines: true,
      },
    });

    if (!template) throw new ApiError('Recurring invoice not found', 404);

    // 2. Validate template is ACTIVE
    if (template.status !== 'ACTIVE') {
      throw new ApiError(`Cannot generate invoice: template status is ${template.status}`, 422);
    }
    await assertItemsActive(tx, orgId, template.lines.map((line) => line.itemId));

    const invoiceNumber = await nextInvoiceNumber(tx, orgId, { issueDate: template.nextRunDate });

    // 5. Create SalesInvoice
    const issueDate = new Date(template.nextRunDate);
    const dueDate = new Date(template.nextRunDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await tx.salesInvoice.create({
      data: {
        organizationId: orgId,
        number: invoiceNumber,
        customerId: template.customerId,
        invoiceType: 'Sales Invoice',
        issueDate,
        dueDate,
        currency: 'IDR',
        status: template.autoPost ? 'SENT' : 'DRAFT',
        recurringInvoiceId: template.id,
        notes: template.notes || null,
        ...recurringInvoiceAmounts(template),
      },
      select: { id: true, number: true },
    });

    // 6a. Gate the auto-posted invoice through the approval engine. An autoPost
    // template creates a live SENT invoice; if ar_invoices approval is required
    // this must instead be HELD (PENDING_APPROVAL) so it does not go live and
    // skip the gate. DRAFT invoices (autoPost false) never go live → no gating.
    let heldForApproval = false;
    if (template.autoPost) {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'INVOICE',
        documentId: invoice.id,
      });
      if (routed) {
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
        heldForApproval = true;
      } else {
        // Approval off / not required → the SENT invoice is live, so its GL must
        // actually post. Without this, the doc was recognised as live revenue
        // with no journal entry behind it. postInvoiceSend posts AR/Sales/(tax)/
        // COGS and asserts the period is open internally.
        await postInvoiceSend(tx, orgId, invoice.id);
      }
    }

    // 7. Calculate next nextRunDate
    const newNextRunDate = nextRecurringDate(
      new Date(template.nextRunDate),
      template.frequency,
      template.dayOfMonth,
    );

    // If nextRunDate > endDate, set status = ENDED
    const shouldEnd =
      template.endDate !== null &&
      template.endDate !== undefined &&
      newNextRunDate > new Date(template.endDate);

    // 8. Update template
    await tx.recurringInvoice.update({
      where: { id: template.id },
      data: {
        nextRunDate: newNextRunDate,
        status: shouldEnd ? 'ENDED' : 'ACTIVE',
        updatedAt: new Date(),
      },
    });

    // 9. Return result. Reflect the held status so callers don't show the
    // invoice as live when it was actually routed for approval.
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      nextRunDate: newNextRunDate,
      status: heldForApproval ? 'PENDING_APPROVAL' : template.autoPost ? 'SENT' : 'DRAFT',
    };
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SalesInvoice',
    entityId: result.invoiceId,
    action: 'CREATE',
    payload: { number: result.invoiceNumber, recurringInvoiceId: id, source: 'MANUAL_GENERATE' },
  });

  return ok(result, 201);
});
