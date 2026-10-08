import { nextNumber } from '@/lib/api-utils';
import { billingDay, nextRecurringDate } from './billing-calendar';
import { advisoryLockKey } from './advisory-lock';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/api-utils';
import { routeForApproval } from '@/lib/approval/engine';
import { resolveRequesterId } from '@/lib/approval/requester';
import { postBillToLedger } from '@/lib/bill-posting';
import { assertPeriodOpen } from '@/lib/period-guard';
import { assertItemsActive } from '@/lib/item-availability';

type GenerateResult =
  | { ok: true; templateId: string; billId: string; billNumber: string }
  | { ok: false; templateId: string; error: string }
  | { ok: true; templateId: string; skipped: true };

/**
 * Generates a single Bill from a recurring-expense template.
 * Runs inside its own transaction to isolate failures per template.
 */
async function generateFromTemplate(
  orgId: string,
  templateId: string,
  userId: string,
  today: Date,
  expectedRunDate: Date,
): Promise<GenerateResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey('recurring-bill:' + templateId)})`;
      const template = await tx.recurringBill.findFirst({
        where: { id: templateId, organizationId: orgId },
        include: { lines: true },
      });

      if (!template) throw new Error('Template not found');
      if (template.status !== 'ACTIVE' || template.nextRunDate > today || template.nextRunDate.getTime() !== expectedRunDate.getTime()) return null;
      if (template.endDate && template.nextRunDate > template.endDate) {
        await tx.recurringBill.update({ where: { id: template.id }, data: { status: 'ENDED' } });
        return null;
      }
      await assertItemsActive(tx, orgId, template.lines.map((line) => line.itemId));

      const billNumber = await nextNumber(tx, 'Bill', 'number', 'BILL');

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
      const newNextRunDate = nextRecurringDate(
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

    return result ? { ok: true, templateId, ...result } : { ok: true, templateId, skipped: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, templateId, error: message };
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function runDueRecurringBills(orgId: string, actorId: string | null = null, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
  const today = billingDay(now, org.timezone);
  // Page template IDs, not all documents; attempt one selected occurrence per template per sweep.
  const results: PromiseSettledResult<GenerateResult>[] = [];
  let cursor: string | undefined;
  let requesterId: string | undefined;
  for (;;) {
    const templates = await prisma.recurringBill.findMany({
      where: { organizationId: orgId, status: 'ACTIVE', nextRunDate: { lte: today },
        ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, nextRunDate: true }, orderBy: { id: 'asc' }, take: 100,
    });
    if (!templates.length) break;
    requesterId ??= await resolveRequesterId(orgId, actorId, 'recurring bills');
    for (const t of templates) results.push({ status: 'fulfilled',
      value: await generateFromTemplate(orgId, t.id, requesterId, today, t.nextRunDate) });
    cursor = templates[templates.length - 1].id;
    if (templates.length < 100) break;
  }

  const generated: string[] = [];
  const errors: Array<{ templateId: string; error: string }> = [];

  for (const settled of results) {
    if (settled.status === 'fulfilled') {
      const r = settled.value;
      if (r.ok && 'skipped' in r) continue;
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

  return {
    generated: generated.length,
    billNumbers: generated,
    errors,
  };
}
