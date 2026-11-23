import { recurringBillAmounts } from '@/lib/recurring-document-totals';
import { nextNumber } from '@/lib/api-utils';
import { advisoryLockKey } from '@/lib/advisory-lock';
import { nextRecurringDate } from '@/lib/billing-calendar';
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
import { routeForApproval } from '@/lib/approval/engine';
import { postBillToLedger } from '@/lib/bill-posting';
import { assertPeriodOpen } from '@/lib/period-guard';
import { withPermission } from '@/lib/authz';
import { assertItemsActive } from '@/lib/item-availability';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// FNV-1a 32-bit hash for advisory lock IDs
// ─── Route ───────────────────────────────────────────────────────────────────

export const POST = withPermission({ module: 'AP_BILLS', action: 'create' }, async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const orgId = requireOrg(req);
  // Manual "Generate now": a user clicked the button, so we require their id —
  // it becomes the ApprovalRequest.requestedById (a required FK) when the
  // auto-posted bill is held for approval. Refuse rather than route with a null
  // requester, which would either crash on the FK or reintroduce a bypass.
  const userId = req.headers.get('x-user-id');
  if (!userId) throw new ApiError('Unauthenticated', 401);
  const { id } = await ctx.params;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey('recurring-bill:' + id)})`;
    // 1. Load template with lines and vendor
    const template = await tx.recurringBill.findFirst({
      where: { id, organizationId: orgId },
      include: {
        vendor: { select: { id: true, name: true } },
        lines: true,
      },
    });

    if (!template) throw new ApiError('Recurring bill not found', 404);

    // 2. Validate template is ACTIVE
    if (template.status !== 'ACTIVE') {
      throw new ApiError(`Cannot generate bill: template status is ${template.status}`, 422);
    }
    await assertItemsActive(tx, orgId, template.lines.map((line) => line.itemId));

    const billNumber = await nextNumber(tx, 'Bill', 'number', 'BILL');

    // 5. Create Bill
    const issueDate = new Date(template.nextRunDate);
    const dueDate = new Date(template.nextRunDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const bill = await tx.bill.create({
      data: {
        organizationId: orgId,
        number: billNumber,
        vendorId: template.vendorId,
        issueDate,
        dueDate,
        status: template.autoPost ? 'OPEN' : 'DRAFT',
        recurringBillId: template.id,
        notes: template.notes || null,
        ...recurringBillAmounts(template),
      },
      include: { lines: true, charges: true },
    });

    // 6a. Gate the auto-posted bill through the approval engine. An autoPost
    // template creates a live OPEN (payable) bill; if ap_bills approval is
    // required this must instead be HELD (PENDING_APPROVAL) so it does not enter
    // AP aging and skip the gate. DRAFT bills (autoPost false) never go live → no gating.
    let heldForApproval = false;
    if (template.autoPost) {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'BILL',
        documentId: bill.id,
      });
      if (routed) {
        await tx.bill.update({
          where: { id: bill.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
        heldForApproval = true;
      } else {
        // Approval off / not required → the OPEN bill is live (in AP aging), so
        // its GL must actually post. Mirrors the BILL finalizer / bills[id]
        // DRAFT→OPEN path: assert the period, then post inventory/expense/AP.
        // postBillToLedger needs the bill WITH its lines (PostableBill shape).
        await assertPeriodOpen(tx, orgId, new Date(issueDate));
        await postBillToLedger(tx, orgId, bill);
      }
    }

    // 7. Calculate next nextRunDate
    const newNextRunDate = nextRecurringDate(
      new Date(template.nextRunDate),
      template.frequency,
      template.dayOfMonth,
    );

    const shouldEnd =
      template.endDate !== null &&
      template.endDate !== undefined &&
      newNextRunDate > new Date(template.endDate);

    // 8. Update template
    await tx.recurringBill.update({
      where: { id: template.id },
      data: {
        nextRunDate: newNextRunDate,
        status: shouldEnd ? 'ENDED' : 'ACTIVE',
        updatedAt: new Date(),
      },
    });

    // Reflect the held status so callers don't show the bill as live (OPEN)
    // when it was actually routed for approval.
    return {
      billId: bill.id,
      billNumber: bill.number,
      nextRunDate: newNextRunDate,
      status: heldForApproval ? 'PENDING_APPROVAL' : template.autoPost ? 'OPEN' : 'DRAFT',
    };
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Bill',
    entityId: result.billId,
    action: 'CREATE',
    payload: { number: result.billNumber, recurringBillId: id, source: 'MANUAL_GENERATE' },
  });

  return ok(result, 201);
});
