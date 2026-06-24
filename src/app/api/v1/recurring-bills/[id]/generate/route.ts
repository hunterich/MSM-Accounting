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

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcNextRunDate(current: Date, frequency: string, dayOfMonth?: number | null): Date {
  const d = new Date(current);
  switch (frequency) {
    case 'DAILY':   d.setDate(d.getDate() + 1); break;
    case 'WEEKLY':  d.setDate(d.getDate() + 7); break;
    case 'MONTHLY': {
      d.setMonth(d.getMonth() + 1);
      if (dayOfMonth) {
        const dom = Math.min(dayOfMonth, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
        d.setDate(dom);
      }
      break;
    }
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3); break;
    case 'ANNUAL':    d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

// FNV-1a 32-bit hash for advisory lock IDs
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash || 1;
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const POST = withHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const orgId = requireOrg(req);
  // Manual "Generate now": a user clicked the button, so we require their id —
  // it becomes the ApprovalRequest.requestedById (a required FK) when the
  // auto-posted bill is held for approval. Refuse rather than route with a null
  // requester, which would either crash on the FK or reintroduce a bypass.
  const userId = req.headers.get('x-user-id');
  if (!userId) throw new ApiError('Unauthenticated', 401);
  const { id } = await ctx.params;

  const result = await prisma.$transaction(async (tx) => {
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

    // 3. Generate sequential bill number with advisory lock
    const lockKey = fnv1aHash(`bill-seq:${orgId}`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max
      FROM "Bill"
      WHERE "organizationId" = ${orgId}
    `;
    const nextSeq = (Number(rows[0]?.max ?? 0)) + 1;
    const billNumber = `BILL-${String(nextSeq).padStart(5, '0')}`;

    // 4. Compute totals
    const taxRate = Number(template.taxRate);
    let subtotal = 0;
    for (const line of template.lines) {
      const qty = Number(line.quantity);
      const price = Number(line.price);
      const discountPct = Number(line.discountPct);
      subtotal += qty * price * (1 - discountPct / 100);
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const taxableSubtotal = template.lines.reduce((sum, line) => {
      if (!line.taxable) return sum;
      const qty = Number(line.quantity);
      const price = Number(line.price);
      const discountPct = Number(line.discountPct);
      return sum + qty * price * (1 - discountPct / 100);
    }, 0);
    const taxAmount = Math.round(taxableSubtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

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
        taxRate,
        taxAmount,
        subtotal,
        totalAmount,
        notes: template.notes || null,
        // 6. Create bill lines from template lines
        lines: {
          create: template.lines.map((line) => ({
            lineNo: line.lineNo,
            itemId: line.itemId || null,
            accountId: line.accountId || null,
            description: line.description,
            quantity: Number(line.quantity),
            unit: line.unit || 'PCS',
            price: Number(line.price),
            lineTotal: Math.round(
              Number(line.quantity) * Number(line.price) * (1 - Number(line.discountPct) / 100) * 100,
            ) / 100,
          })),
        },
      },
      select: { id: true, number: true },
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
        const billWithLines = await tx.bill.findFirst({
          where: { id: bill.id, organizationId: orgId },
          include: { lines: true },
        });
        await assertPeriodOpen(tx, orgId, new Date(issueDate));
        await postBillToLedger(tx, orgId, billWithLines as never);
      }
    }

    // 7. Calculate next nextRunDate
    const newNextRunDate = calcNextRunDate(
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
