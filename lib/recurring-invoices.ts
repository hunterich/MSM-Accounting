import { billingDay, nextRecurringDate } from './billing-calendar';
import { advisoryLockKey } from './advisory-lock';
import { nextInvoiceNumber } from './invoice-number';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/api-utils';
import { routeForApproval } from '@/lib/approval/engine';
import { resolveRequesterId } from '@/lib/approval/requester';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { assertItemsActive } from '@/lib/item-availability';

type GenerateResult =
  | { ok: true; templateId: string; invoiceId: string; invoiceNumber: string }
  | { ok: false; templateId: string; error: string }
  | { ok: true; templateId: string; skipped: true };

/**
 * Generates a single SalesInvoice from a recurring template.
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey('recurring-invoice:' + templateId)})`;
      const template = await tx.recurringInvoice.findFirst({
        where: { id: templateId, organizationId: orgId },
        include: { lines: true },
      });

      if (!template) throw new Error('Template not found');
      if (template.status !== 'ACTIVE' || template.nextRunDate > today || template.nextRunDate.getTime() !== expectedRunDate.getTime()) return null;
      if (template.endDate && template.nextRunDate > template.endDate) {
        await tx.recurringInvoice.update({ where: { id: template.id }, data: { status: 'ENDED' } });
        return null;
      }
      await assertItemsActive(tx, orgId, template.lines.map((line) => line.itemId));

      const invoiceNumber = await nextInvoiceNumber(tx, orgId, { issueDate: template.nextRunDate });

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
          taxEnabled: taxRate > 0,
          taxInclusive: false,
          taxRate,
          taxAmount,
          subtotal,
          discountPct: 0,
          discountAmount: 0,
          totalAmount,
          notes: template.notes || null,
          lines: {
            create: template.lines.map((line) => ({
              lineNo: line.lineNo,
              itemId: line.itemId || null,
              description: line.description,
              quantity: Number(line.quantity),
              unit: line.unit || 'PCS',
              price: Number(line.price),
              discountPct: Number(line.discountPct),
              lineSubtotal: Math.round(
                Number(line.quantity) * Number(line.price) * (1 - Number(line.discountPct) / 100) * 100,
              ) / 100,
            })),
          },
        },
        select: { id: true, number: true },
      });

      // Gate the auto-posted invoice through the approval engine. An autoPost
      // template creates a live SENT invoice; if ar_invoices approval is
      // required this must instead be HELD (PENDING_APPROVAL) so it does not go
      // live and skip the gate. DRAFT invoices (autoPost false) never go live.
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
        } else {
          // Approval off / not required → the SENT invoice is live, so its GL
          // must actually post. postInvoiceSend posts AR/Sales/(tax)/COGS and
          // asserts the period is open internally (throws into the per-doc
          // catch, isolating a locked-period failure to this one template).
          await postInvoiceSend(tx, orgId, invoice.id);
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

      await tx.recurringInvoice.update({
        where: { id: template.id },
        data: {
          nextRunDate: newNextRunDate,
          status: shouldEnd ? 'ENDED' : 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      return { invoiceId: invoice.id, invoiceNumber: invoice.number };
    });

    return result ? { ok: true, templateId, ...result } : { ok: true, templateId, skipped: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, templateId, error: message };
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function runDueRecurringInvoices(orgId: string, actorId: string | null = null, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
  const today = billingDay(now, org.timezone);
  // Page template IDs, not all documents; attempt one selected occurrence per template per sweep.
  const results: PromiseSettledResult<GenerateResult>[] = [];
  let cursor: string | undefined;
  let requesterId: string | undefined;
  for (;;) {
    const templates = await prisma.recurringInvoice.findMany({
      where: { organizationId: orgId, status: 'ACTIVE', nextRunDate: { lte: today },
        ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, nextRunDate: true }, orderBy: { id: 'asc' }, take: 100,
    });
    if (!templates.length) break;
    requesterId ??= await resolveRequesterId(orgId, actorId, 'recurring invoices');
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
        generated.push(r.invoiceNumber);
        logAudit({
          orgId,
          actorId,
          entityType: 'SalesInvoice',
          entityId: r.invoiceId,
          action: 'CREATE',
          payload: {
            number: r.invoiceNumber,
            recurringInvoiceId: r.templateId,
            source: 'CRON',
          },
        });
      } else {
        errors.push({ templateId: r.templateId, error: r.error });
      }
    } else {
      // Promise itself rejected — should not normally happen given inner try/catch
      errors.push({ templateId: 'unknown', error: String(settled.reason) });
    }
  }

  // 4. Return summary
  return {
    generated: generated.length,
    invoiceNumbers: generated,
    errors,
  };
}
