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
import { postInvoiceSend } from '@/lib/invoice-send-posting';

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
  | { ok: true; templateId: string; invoiceId: string; invoiceNumber: string }
  | { ok: false; templateId: string; error: string };

/**
 * Generates a single SalesInvoice from a recurring template.
 * Runs inside its own transaction to isolate failures per template.
 */
async function generateFromTemplate(
  orgId: string,
  templateId: string,
  userId: string,
): Promise<GenerateResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.recurringInvoice.findFirst({
        where: { id: templateId, organizationId: orgId },
        include: { lines: true },
      });

      if (!template) throw new Error('Template not found');
      if (template.status !== 'ACTIVE') throw new Error(`Template status is ${template.status}`);

      // Acquire advisory lock scoped to this org's invoice sequence
      const lockKey = fnv1aHash(`invoice-seq:${orgId}`);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
        SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max
        FROM "SalesInvoice"
        WHERE "organizationId" = ${orgId}
      `;
      const nextSeq = (Number(rows[0]?.max ?? 0)) + 1;
      const invoiceNumber = `INV-${String(nextSeq).padStart(6, '0')}`;

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
      const newNextRunDate = calcNextRunDate(
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

    return { ok: true, templateId, ...result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, templateId, error: message };
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const POST = withHandler(async (req: NextRequest) => {
  // 1. Load org from header
  const orgId = requireOrg(req);
  const actorId = req.headers.get('x-user-id');
  // Resolve the user any held ApprovalRequest will be attributed to: the caller
  // (x-user-id) when present, else the org's admin (deterministic scheduler
  // fallback). Resolved up-front so every template in the batch shares it.
  const requesterId = await resolveRequesterId(orgId, actorId, 'recurring invoices');

  const today = new Date();
  // Normalize to start-of-day UTC so date-only comparison is correct
  today.setUTCHours(0, 0, 0, 0);

  // 2. Find all active templates due today or earlier
  const templates = await prisma.recurringInvoice.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      nextRunDate: { lte: today },
    },
    select: { id: true },
  });

  // 3. Generate invoices for each template (isolated transactions)
  const results = await Promise.allSettled(
    templates.map((t) => generateFromTemplate(orgId, t.id, requesterId)),
  );

  const generated: string[] = [];
  const errors: Array<{ templateId: string; error: string }> = [];

  for (const settled of results) {
    if (settled.status === 'fulfilled') {
      const r = settled.value;
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
  return ok({
    generated: generated.length,
    invoiceNumbers: generated,
    errors,
  });
});
