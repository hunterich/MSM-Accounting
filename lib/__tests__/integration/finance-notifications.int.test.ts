import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect } from './harness';
import { queueFinanceNotifications, deliverFinanceNotifications } from '../../finance-notifications';

afterAll(disconnect);
beforeEach(() => vi.stubEnv('RESEND_API_KEY', 'mock-provider-only'));
afterEach(() => vi.unstubAllEnvs());
const now = new Date('2026-10-08T02:00:00Z');
async function orgFixture() {
  const { orgId } = await createTestOrg();
  return prisma.organization.update({ where: { id: orgId }, data: {
    financeEmail: 'finance@example.test', invoiceReminders: true, paymentAlerts: true, dailySummary: true,
  } });
}

it('does not queue while the provider is absent and advances the payment baseline without replaying offline history', async () => {
  const org = await orgFixture();
  try {
    vi.stubEnv('RESEND_API_KEY', '');
    await queueFinanceNotifications(org, now);
    const customerId = await createCustomer(org.id);
    const later = new Date(now.getTime() + 2 * 86_400_000);
    await prisma.aRPayment.create({ data: { organizationId: org.id, customerId, number: 'OFFLINE', date: now,
      status: 'COMPLETED', totalAmount: 100, updatedAt: new Date(later.getTime() - 1000) } });
    await queueFinanceNotifications(org, later);
    expect(await prisma.notificationDelivery.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await prisma.automationCheckpoint.findUniqueOrThrow({ where: { organizationId_job: { organizationId: org.id, job: 'PAYMENT_ALERTS' } } })).startedAt).toEqual(later);
    vi.stubEnv('RESEND_API_KEY', 'mock-provider-only');
    await queueFinanceNotifications(org, new Date(later.getTime() + 900_000));
    expect(await prisma.notificationDelivery.count({ where: { organizationId: org.id, kind: 'PAYMENT_ALERT' } })).toBe(0);
    expect(await prisma.notificationDelivery.count({ where: { organizationId: org.id, kind: 'DAILY_SUMMARY' } })).toBe(1);
  } finally { await cleanupOrg(org.id); }
});

it('cancels a legacy unattempted backlog even while offline and sends only recent notifications after setup', async () => {
  const org = await orgFixture();
  try {
    for (const kind of ['PAYMENT_ALERT', 'INVOICE_REMINDER', 'DAILY_SUMMARY']) {
      await prisma.notificationDelivery.create({ data: { organizationId: org.id, key: `stale:${kind}`, kind,
        recipient: org.financeEmail!, subject: kind, bodyText: 'Old backlog', availableAt: new Date(0),
        createdAt: new Date(now.getTime() - 86_400_000) } });
    }
    const fresh = await prisma.notificationDelivery.create({ data: { organizationId: org.id, key: 'fresh', kind: 'DAILY_SUMMARY',
      recipient: org.financeEmail!, subject: 'Current', bodyText: 'Current', availableAt: new Date(0), createdAt: now } });
    const send = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv('RESEND_API_KEY', '');
    await deliverFinanceNotifications(now, send);
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.notificationDelivery.count({ where: { organizationId: org.id, status: 'CANCELLED' } })).toBe(3);
    vi.stubEnv('RESEND_API_KEY', 'mock-provider-only');
    await deliverFinanceNotifications(now, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('SENT');
  } finally { await cleanupOrg(org.id); }
});

it('queues correct outstanding amounts and one daily digest under overlapping sweeps; excludes drafts', async () => {
  const org = await orgFixture();
  try {
    const customerId = await createCustomer(org.id);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.id, customerId,
      number: 'LIVE', issueDate: new Date('2026-10-07T03:00:00Z'), dueDate: new Date('2026-10-08'),
      status: 'SENT', subtotal: 1000, totalAmount: 1000 } });
    await prisma.salesInvoice.create({ data: { organizationId: org.id, customerId, number: 'DRAFT',
      issueDate: now, dueDate: new Date('2026-10-07'), subtotal: 9999, totalAmount: 9999 } });
    await prisma.aRPayment.create({ data: { organizationId: org.id, customerId, number: 'OLD-RECEIPT', date: now,
      status: 'COMPLETED', totalAmount: 200, updatedAt: new Date('2026-10-06'),
      allocations: { create: [{ invoiceId: invoice.id, amountApplied: 200, discountAmount: 50 }] } } });
    await prisma.creditNote.create({ data: { organizationId: org.id, customerId, sourceInvoiceId: invoice.id,
      number: 'CREDIT', date: now, amount: 100, status: 'APPLIED', settlementType: 'APPLY_TO_INVOICE' } });
    await Promise.all([queueFinanceNotifications(org, now), queueFinanceNotifications(org, now)]);
    const rows = await prisma.notificationDelivery.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(2);
    const reminder = rows.find(r => r.kind === 'INVOICE_REMINDER')!;
    expect(reminder.recipient).toBe('finance@example.test');
    expect(reminder.bodyText).toContain(new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(650));
    expect(reminder.bodyText).not.toContain('DRAFT');
    expect(rows.find(r => r.kind === 'DAILY_SUMMARY')!.bodyText).toContain('Live invoices: 1');
  } finally { await cleanupOrg(org.id); }
});

it('payment checkpoint skips history, catches new AR/AP completions after restart, and de-duplicates scans', async () => {
  const org = await orgFixture();
  try {
    const customerId = await createCustomer(org.id);
    const vendorId = await createVendor(org.id);
    await prisma.aRPayment.create({ data: { organizationId: org.id, customerId, number: 'HISTORICAL',
      date: now, status: 'COMPLETED', totalAmount: 999, updatedAt: new Date(now.getTime() - 1000) } });
    await queueFinanceNotifications(org, now);
    const later = new Date(now.getTime() + 900_000);
    await prisma.aRPayment.create({ data: { organizationId: org.id, customerId, number: 'NEW-AR', date: now,
      status: 'COMPLETED', totalAmount: 200, updatedAt: later } });
    await prisma.aPPayment.create({ data: { organizationId: org.id, vendorId, number: 'NEW-AP', date: now,
      status: 'COMPLETED', totalAmount: 300, updatedAt: later } });
    await queueFinanceNotifications(org, later);
    await queueFinanceNotifications(org, new Date(later.getTime() + 900_000));
    const rows = await prisma.notificationDelivery.findMany({ where: { organizationId: org.id, kind: 'PAYMENT_ALERT' } });
    expect(rows).toHaveLength(2);
    expect(rows.some(r => r.subject.includes('HISTORICAL'))).toBe(false);
    expect(rows.map(r => r.subject).join()).toContain('NEW-AR');
    expect(rows.map(r => r.subject).join()).toContain('NEW-AP');
  } finally { await cleanupOrg(org.id); }
});

it('leases exclude concurrent workers, retries retain provider key, and changed settings cancel queued mail', async () => {
  vi.stubEnv('RESEND_API_KEY', 'mock-provider-only');
  const org = await orgFixture();
  try {
    const delivery = await prisma.notificationDelivery.create({ data: { organizationId: org.id, key: 'test',
      kind: 'PAYMENT_ALERT', recipient: org.financeEmail!, subject: 'Test alert', bodyText: 'Test body', availableAt: new Date(0) } });
    const send = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue(undefined);
    await deliverFinanceNotifications(now, send);
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('PENDING');
    const retryAt = new Date(now.getTime() + 900_000);
    await Promise.all([deliverFinanceNotifications(retryAt, send), deliverFinanceNotifications(retryAt, send)]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].idempotencyKey).toBe(send.mock.calls[1][0].idempotencyKey);
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('SENT');
    const cancelled = await prisma.notificationDelivery.create({ data: { organizationId: org.id, key: 'cancel',
      kind: 'PAYMENT_ALERT', recipient: org.financeEmail!, subject: 'Cancel', bodyText: 'Cancel', availableAt: new Date(0) } });
    await prisma.organization.update({ where: { id: org.id }, data: { paymentAlerts: false } });
    await deliverFinanceNotifications(retryAt, send);
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: cancelled.id } })).status).toBe('CANCELLED');
    expect(send).toHaveBeenCalledTimes(2);
  } finally { await cleanupOrg(org.id); vi.unstubAllEnvs(); }
});

it('does not send without a provider key or retry uncertain deliveries past the provider window', async () => {
  vi.stubEnv('RESEND_API_KEY', '');
  const org = await orgFixture();
  try {
    const delivery = await prisma.notificationDelivery.create({ data: { organizationId: org.id, key: 'old-attempt',
      kind: 'PAYMENT_ALERT', recipient: org.financeEmail!, subject: 'Old', bodyText: 'Old', availableAt: new Date(0),
      status: 'PROCESSING', attempts: 1, leaseUntil: new Date(0), firstAttemptAt: new Date(now.getTime() - 24 * 3_600_000) } });
    const send = vi.fn();
    await deliverFinanceNotifications(now, send);
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv('RESEND_API_KEY', 'mock-provider-only');
    await deliverFinanceNotifications(now, send);
    expect(send).not.toHaveBeenCalled();
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('FAILED');
  } finally { await cleanupOrg(org.id); vi.unstubAllEnvs(); }
});
