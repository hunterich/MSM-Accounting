import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  ok,
  requireOrg,
  withHandler,
  logAudit,
} from '@/lib/api-utils';
import { routeForApproval } from '@/lib/approval/engine';
import { resolveRequesterId } from '@/lib/approval/requester';
import { postBillToLedger } from '@/lib/bill-posting';
import { assertPeriodOpen } from '@/lib/period-guard';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

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

type GenerateResult =
  | { ok: true; templateId: string; billId: string; billNumber: string }
  | { ok: false; templateId: string; error: string };

/**
 * Generates a single Bill from a recurring-expense template.
 * Runs inside its own transaction to isolate failures per template.
 */
async function generateFromTemplate(
  orgId: string,
  templateId: string,
  userId: string,
): Promise<GenerateResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.recurringBill.findFirst({
        where: { id: templateId, organizationId: orgId },
        include: { lines: true },
      });

      if (!template) throw new Error('Template not found');
      if (template.status !== 'ACTIVE') throw new Error(`Template status is ${template.status}`);

      // Acquire advisory lock scoped to this org's bill sequence
      const lockKey = fnv1aHash(`bill-seq:${orgId}`);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
        SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max
        FROM "Bill"
        WHERE "organizationId" = ${orgId}
      `;
      const nextSeq = (Number(rows[0]?.max ?? 0)) + 1;
      const billNumber = `BILL-${String(nextSeq).padStart(5, '0')}`;

      // Compute totals
      const taxRate = Number(template.taxRate);
      const subtotal = Math.round(
        template.lines.reduce((sum, line) => {
          const qty = Number(line.quantity);
          const price = Number(line.price);
          const discountPct = Number(line.discountPct);
          return sum + qty * price * (1 - discountPct / 100);
        }, 0) * 100,
      ) / 100;

      const taxableSubtotal = Math.round(
        template.lines.reduce((sum, line) => {
          if (!line.taxable) return sum;
          const qty = Number(line.quantity);
          const price = Number(line.price);
          const discountPct = Number(line.discountPct);
          return sum + qty * price * (1 - discountPct / 100);
        }, 0) * 100,
      ) / 100;

      const taxAmount = Math.round(taxableSubtotal * (taxRate / 100) * 100) / 100;
      const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

      // PPN classification: carry the template's tax flag onto the Bill so
      // postBillToLedger books a separate DR Input Tax (apTax) line instead of
      // burying the PPN inside the expense/inventory debit. postBillToLedger
      // applies the *bill-level* taxable flag uniformly to every line (no
      // per-line tax support), so we only mark the bill taxable when there is
      // positive tax AND every line is taxable — that keeps the booked input
      // tax equal to taxAmount and the AP credit equal to totalAmount. Mixed
      // taxable/non-taxable templates fall back to taxable=false (no over-tax).
      const allLinesTaxable = template.lines.every((line) => line.taxable);
      const billTaxable = taxRate > 0 && taxAmount > 0 && allLinesTaxable;

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
          // autoPost templates produce an OPEN (payable) bill; otherwise a
          // DRAFT for review before it enters AP aging.
          status: template.autoPost ? 'OPEN' : 'DRAFT',
          recurringBillId: template.id,
          taxRate,
          taxable: billTaxable,
          // Recurring templates compute tax exclusively (taxAmount on top of
          // subtotal), so the generated bill is tax-EXCLUSIVE — mirrors the
          // normal bill create default.
          taxInclusive: false,
          taxAmount,
          subtotal,
          totalAmount,
          notes: template.notes || null,
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

      // Gate the auto-posted bill through the approval engine. An autoPost
      // template creates a live OPEN (payable) bill; if ap_bills approval is
      // required this must instead be HELD (PENDING_APPROVAL) so it does not
      // enter AP aging and skip the gate. DRAFT bills (autoPost false) never go live.
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
        } else {
          // Approval off / not required → the OPEN bill is live (in AP aging),
          // so its GL must actually post. Mirrors the BILL finalizer: assert the
          // period, then post inventory/expense/AP. postBillToLedger needs the
          // bill WITH its lines (PostableBill shape). A locked-period throw is
          // caught per-doc, isolating the failure to this one template.
          const billWithLines = await tx.bill.findFirst({
            where: { id: bill.id, organizationId: orgId },
            include: { lines: true },
          });
          await assertPeriodOpen(tx, orgId, new Date(issueDate));
          await postBillToLedger(tx, orgId, billWithLines as never);
        }
      }

      // Advance nextRunDate
      const newNextRunDate = calcNextRunDate(
        new Date(template.nextRunDate),
        template.frequency,
        template.dayOfMonth,
      );

      const shouldEnd =
        template.endDate !== null &&
        template.endDate !== undefined &&
        newNextRunDate > new Date(template.endDate);

      await tx.recurringBill.update({
        where: { id: template.id },
        data: {
          nextRunDate: newNextRunDate,
          status: shouldEnd ? 'ENDED' : 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      return { billId: bill.id, billNumber: bill.number };
    });

    return { ok: true, templateId, ...result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, templateId, error: message };
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const POST = withPermission({ module: 'AP_BILLS', action: 'create' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const actorId = req.headers.get('x-user-id');
  // Resolve the user any held ApprovalRequest will be attributed to: the caller
  // (x-user-id) when present, else the org's admin (deterministic scheduler
  // fallback). Resolved up-front so every template in the batch shares it.
  const requesterId = await resolveRequesterId(orgId, actorId, 'recurring bills');

  const today = new Date();
  // Normalize to start-of-day UTC so date-only comparison is correct
  today.setUTCHours(0, 0, 0, 0);

  const templates = await prisma.recurringBill.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      nextRunDate: { lte: today },
    },
    select: { id: true },
  });

  const results = await Promise.allSettled(
    templates.map((t) => generateFromTemplate(orgId, t.id, requesterId)),
  );

  const generated: string[] = [];
  const errors: Array<{ templateId: string; error: string }> = [];

  for (const settled of results) {
    if (settled.status === 'fulfilled') {
      const r = settled.value;
      if (r.ok) {
        generated.push(r.billNumber);
        logAudit({
          orgId,
          actorId,
          entityType: 'Bill',
          entityId: r.billId,
          action: 'CREATE',
          payload: {
            number: r.billNumber,
            recurringBillId: r.templateId,
            source: 'CRON',
          },
        });
      } else {
        errors.push({ templateId: r.templateId, error: r.error });
      }
    } else {
      errors.push({ templateId: 'unknown', error: String(settled.reason) });
    }
  }

  return ok({
    generated: generated.length,
    billNumbers: generated,
    errors,
  });
});
