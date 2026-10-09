import type { Organization, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { advisoryLockKey } from './advisory-lock';
import { billingDay, businessDayStart } from './billing-calendar';
import { sendFinanceNotification } from './email';

type Org = Pick<Organization, 'id' | 'displayName' | 'timezone' | 'baseCurrency' | 'financeEmail' |
  'emailFromName' | 'invoiceReminders' | 'paymentAlerts' | 'dailySummary'>;
const money = (value: unknown, org: Org) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: org.baseCurrency,
}).format(Number(value ?? 0));

async function enqueue(tx: Prisma.TransactionClient, org: Org, key: string, kind: string, subject: string, bodyText: string) {
  await tx.notificationDelivery.createMany({ data: [{ organizationId: org.id, key, kind,
    recipient: org.financeEmail!, subject, bodyText }], skipDuplicates: true });
}

/** Finance routing is explicitly authorized; customer reminders remain manual. */
export async function queueFinanceNotifications(org: Org, now = new Date()): Promise<void> {
  if (!org.financeEmail?.trim()) return;
  const providerReady = Boolean(process.env.RESEND_API_KEY?.trim());
  const day = billingDay(now, org.timezone);
  const dayLabel = day.toISOString().slice(0, 10);
  const nextDay = new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10);
  const dayEnd = businessDayStart(nextDay, org.timezone);
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: org.timezone,
    hour: '2-digit', hourCycle: 'h23' }).format(now));

  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`finance-notifications:${org.id}`)})`;
    const checkpoint = await tx.automationCheckpoint.findUnique({
      where: { organizationId_job: { organizationId: org.id, job: 'PAYMENT_ALERTS' } },
    });
    if (providerReady && org.paymentAlerts && checkpoint) {
      // Overlap protects transactions whose timestamp preceded the previous scan's commit.
      const since = new Date(Math.max(checkpoint.startedAt.getTime(), checkpoint.lastRunAt.getTime() - 3_600_000));
      for (const kind of ['AR', 'AP'] as const) {
        let cursor: string | undefined;
        for (;;) {
          const args = { where: { organizationId: org.id, status: 'COMPLETED' as const,
            updatedAt: { gte: since, lte: now } }, orderBy: { id: 'asc' as const }, take: 200,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
          const payments = kind === 'AR' ? await tx.aRPayment.findMany(args) : await tx.aPPayment.findMany(args);
          for (const payment of payments) {
            await enqueue(tx, org, `payment:${kind}:${payment.id}`, 'PAYMENT_ALERT',
              `${org.displayName}: ${kind === 'AR' ? 'receipt' : 'payment'} ${payment.number} posted`,
              `${payment.number}\nAmount: ${money(payment.totalAmount, org)}\nDate: ${payment.date.toISOString().slice(0, 10)}\nStatus: COMPLETED\nReview the payment in MSM Accounting.`);
          }
          if (payments.length < 200) break;
          cursor = payments[payments.length - 1].id;
        }
      }
    }
    // On first setup establish a baseline instead of emailing historical payments.
    await tx.automationCheckpoint.upsert({
      where: { organizationId_job: { organizationId: org.id, job: 'PAYMENT_ALERTS' } },
      create: { organizationId: org.id, job: 'PAYMENT_ALERTS', lastRunAt: now, startedAt: now },
      update: { lastRunAt: now, ...(!org.paymentAlerts || !providerReady ? { startedAt: now } : {}) },
    });
    // Keep the payment baseline current while offline; enabling email later
    // must not replay payments from the provider-less interval.
    if (!providerReady) return;
    if (localHour < 8) return;
    const alreadyQueued = async (key: string) => Boolean(await tx.notificationDelivery.findUnique({
      where: { organizationId_key: { organizationId: org.id, key } }, select: { id: true },
    }));
    if (org.invoiceReminders && !await alreadyQueued(`reminder:${dayLabel}`)) {
      const rows = await tx.$queryRaw<Array<{ number: string; outstanding: number; count: bigint; total: number }>>`
        WITH balances AS (
          SELECT i."number", GREATEST(0, i."totalAmount" -
            COALESCE((SELECT SUM(a."amountApplied" + a."discountAmount")
              FROM "ARPaymentAllocation" a JOIN "ARPayment" p ON p.id = a."paymentId"
              WHERE a."invoiceId" = i.id AND p.status = 'COMPLETED'), 0) -
            COALESCE((SELECT SUM(n.amount) FROM "CreditNote" n WHERE n."sourceInvoiceId" = i.id
              AND n.status = 'APPLIED' AND n."settlementType" = 'APPLY_TO_INVOICE'), 0)) AS outstanding
          FROM "SalesInvoice" i WHERE i."organizationId" = ${org.id} AND i.status IN ('SENT', 'OVERDUE')
            AND i."deletedAt" IS NULL AND i."dueDate" < ${dayEnd}
        ) SELECT "number", outstanding, COUNT(*) OVER () AS count, SUM(outstanding) OVER () AS total
          FROM balances WHERE outstanding > 0 ORDER BY "number" LIMIT 20
      `;
      if (rows.length) await enqueue(tx, org, `reminder:${dayLabel}`, 'INVOICE_REMINDER',
        `${org.displayName}: invoices due or overdue — ${dayLabel}`,
        `${rows[0].count} outstanding invoices due by ${dayLabel}; total ${money(rows[0].total, org)}.\n` +
        rows.map(r => `${r.number}: ${money(r.outstanding, org)}`).join('\n') +
        '\nShowing up to 20 invoices. Open AR Aging for the complete list.');
    }
    if (org.dailySummary && !await alreadyQueued(`summary:${dayLabel}`)) {
      const yesterday = new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
      const date = { gte: businessDayStart(yesterday, org.timezone), lt: businessDayStart(dayLabel, org.timezone) };
      const [sales, receipts, payments] = await Promise.all([
        tx.salesInvoice.aggregate({ where: { organizationId: org.id, deletedAt: null,
          status: { in: ['SENT', 'OVERDUE', 'PAID'] }, issueDate: date }, _count: true, _sum: { totalAmount: true } }),
        tx.aRPayment.aggregate({ where: { organizationId: org.id, status: 'COMPLETED', date }, _count: true, _sum: { totalAmount: true } }),
        tx.aPPayment.aggregate({ where: { organizationId: org.id, status: 'COMPLETED', date }, _count: true, _sum: { totalAmount: true } }),
      ]);
      await enqueue(tx, org, `summary:${dayLabel}`, 'DAILY_SUMMARY', `${org.displayName}: daily activity — ${yesterday}`,
        `Document-date activity for ${yesterday} (${org.timezone}), using current statuses at send time.\n` +
        `Live invoices: ${sales._count}, ${money(sales._sum.totalAmount, org)}\n` +
        `Completed receipts: ${receipts._count}, ${money(receipts._sum.totalAmount, org)}\n` +
        `Completed payments: ${payments._count}, ${money(payments._sum.totalAmount, org)}\n` +
        'This activity digest is not a historical financial statement.');
    }
  }, { timeout: 60_000 });
}

export function notificationEnabled(org: Org, kind: string): boolean {
  return kind === 'PAYMENT_ALERT' ? org.paymentAlerts : kind === 'INVOICE_REMINDER' ? org.invoiceReminders :
    kind === 'DAILY_SUMMARY' ? org.dailySummary : false;
}

export async function deliverFinanceNotifications(now = new Date(), send = sendFinanceNotification): Promise<void> {
  // Existing unattempted mail also expires by queue age, not first-send time.
  // Leave attempted deliveries to the provider-idempotency recovery policy.
  await prisma.notificationDelivery.updateMany({ where: {
    status: 'PENDING', attempts: 0, createdAt: { lte: new Date(now.getTime() - 86_400_000) },
    kind: { in: ['PAYMENT_ALERT', 'INVOICE_REMINDER', 'DAILY_SUMMARY'] },
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
  }, data: { status: 'CANCELLED', leaseUntil: null, lastError: 'Unsent notification expired after 24 hours in the queue.' } });
  if (!process.env.RESEND_API_KEY?.trim()) return;
  const pending = await prisma.notificationDelivery.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING'] }, availableAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: { createdAt: 'asc' }, take: 100,
  });
  for (const delivery of pending) {
    const leaseUntil = new Date(now.getTime() + 300_000);
    const claimed = await prisma.notificationDelivery.updateMany({ where: { id: delivery.id,
      status: { in: ['PENDING', 'PROCESSING'] }, attempts: delivery.attempts,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { status: 'PROCESSING', leaseUntil, attempts: { increment: 1 }, firstAttemptAt: delivery.firstAttemptAt ?? now } });
    if (!claimed.count) continue;
    try {
      if (delivery.attempts >= 5) {
        await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: {
          status: 'FAILED', leaseUntil: null, lastError: 'Attempt limit reached; review the last delivery outcome before retry.',
        } });
        continue;
      }
      // Provider keys expire after 24h. An uncertain old attempt requires review, not a possible duplicate email.
      if (delivery.firstAttemptAt && now.getTime() - delivery.firstAttemptAt.getTime() >= 23 * 3_600_000) {
        await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: {
          status: 'FAILED', leaseUntil: null, lastError: 'Delivery outcome uncertain beyond provider idempotency window; review before retry.',
        } });
        continue;
      }
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: delivery.organizationId } });
      if (!notificationEnabled(org, delivery.kind) || org.financeEmail !== delivery.recipient) {
        await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'CANCELLED', leaseUntil: null } });
        continue;
      }
      await send({ to: delivery.recipient, subject: delivery.subject, text: delivery.bodyText,
        emailFromName: org.emailFromName, idempotencyKey: `finance/${delivery.id}` });
      await prisma.notificationDelivery.updateMany({ where: { id: delivery.id, leaseUntil },
        data: { status: 'SENT', sentAt: new Date(), leaseUntil: null, lastError: null } });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      await prisma.notificationDelivery.updateMany({ where: { id: delivery.id, leaseUntil }, data: {
        status: attempts >= 5 ? 'FAILED' : 'PENDING', leaseUntil: null,
        availableAt: new Date(now.getTime() + 60_000 * 2 ** attempts),
        lastError: error instanceof Error ? error.message : String(error),
      } });
      console.error(`[finance-notifications] delivery ${delivery.id} failed:`, error);
    }
  }
}
