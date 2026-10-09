import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect } from './harness';
import { runDueRecurringInvoices } from '../../recurring-invoices';
import { runDueRecurringBills } from '../../recurring-bills';
import { runDueSubscriptions } from '../../subscription-billing';

afterAll(disconnect);
const now = new Date('2026-10-08T01:00:00Z');
const due = new Date('2026-10-08T00:00:00Z');

async function fixtures() {
  const org = await createTestOrg();
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Scheduler admin', passwordHash: 'x' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, roleId: role.id, userId: user.id } });
  return { org, user };
}

it('subscription invoice and journal dates follow the Jakarta business day across midnight, with unchanged retry safety', async () => {
  for (const [instant, label] of [['2026-10-08T16:59:00Z', '2026-10-08'], ['2026-10-08T17:01:00Z', '2026-10-09']]) {
    const { org, user } = await fixtures();
    try {
      const customerId = await createCustomer(org.orgId);
      const plan = await prisma.subscriptionPlan.create({ data: { organizationId: org.orgId, name: 'Midnight plan', price: 100, interval: 'MONTHLY' } });
      const subscription = await prisma.subscription.create({ data: { organizationId: org.orgId, customerId, planId: plan.id, status: 'ACTIVE',
        startDate: new Date('2026-09-08'), currentPeriodStart: new Date('2026-09-08'), currentPeriodEnd: new Date('2026-10-08'), nextInvoiceDate: new Date('2026-10-08') } });
      const result = await runDueSubscriptions(org.orgId, user.id, new Date(instant));
      expect(result.errors).toEqual([]);
      expect(result.generated).toBe(1);
      const invoice = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: result.invoices[0].invoiceId } });
      expect(invoice.issueDate).toEqual(new Date(`${label}T00:00:00Z`));
      const journal = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.orgId, memo: { contains: invoice.number } } });
      expect(journal.date).toEqual(invoice.issueDate);
      expect((await runDueSubscriptions(org.orgId, user.id, new Date(instant))).generated).toBe(0);
      expect(await prisma.salesInvoice.count({ where: { organizationId: org.orgId } })).toBe(1);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).nextInvoiceDate).not.toEqual(new Date('2026-10-08'));
    } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
  }
});

it('overlapping due sweeps generate one invoice and one bill per occurrence, with no draft journals', async () => {
  const { org, user } = await fixtures();
  try {
    const customerId = await createCustomer(org.orgId);
    const vendorId = await createVendor(org.orgId);
    const invoiceTemplate = await prisma.recurringInvoice.create({ data: { organizationId: org.orgId, customerId,
      title: 'Service', frequency: 'MONTHLY', startDate: due, nextRunDate: due, autoPost: false,
      lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: 100, taxable: false }] } } });
    const billTemplate = await prisma.recurringBill.create({ data: { organizationId: org.orgId, vendorId,
      title: 'Expense', frequency: 'MONTHLY', startDate: due, nextRunDate: due, autoPost: false,
      lines: { create: [{ lineNo: 1, description: 'Expense', quantity: 1, price: 100, taxable: false }] } } });
    await Promise.all([runDueRecurringInvoices(org.orgId, null, now), runDueRecurringInvoices(org.orgId, null, now)]);
    await Promise.all([runDueRecurringBills(org.orgId, null, now), runDueRecurringBills(org.orgId, null, now)]);
    expect(await prisma.salesInvoice.count({ where: { recurringInvoiceId: invoiceTemplate.id } })).toBe(1);
    expect(await prisma.bill.count({ where: { recurringBillId: billTemplate.id } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
    expect((await runDueRecurringInvoices(org.orgId, null, now)).generated).toBe(0);
    expect((await runDueRecurringBills(org.orgId, null, now)).generated).toBe(0);
  } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});

it('rejects inactive scheduler administrators and expires templates past their end date', async () => {
  const { org, user } = await fixtures();
  try {
    const customerId = await createCustomer(org.orgId);
    const template = await prisma.recurringInvoice.create({ data: { organizationId: org.orgId, customerId,
      title: 'Expired', frequency: 'MONTHLY', startDate: due, nextRunDate: due, endDate: new Date('2026-10-07'), autoPost: false,
      lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: 100 }] } } });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    await expect(runDueRecurringInvoices(org.orgId, null, now)).rejects.toThrow('no admin');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    expect((await runDueRecurringInvoices(org.orgId, null, now)).generated).toBe(0);
    expect((await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: template.id } })).status).toBe('ENDED');
  } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});
