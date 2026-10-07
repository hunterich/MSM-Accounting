import { afterAll, expect, it } from 'vitest';
import { dashboardAging } from '@/lib/dashboard-aging';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect } from './harness';
afterAll(disconnect);

it('aggregates aging boundaries, cleared discounts, status and tenant isolation', async () => {
  const org = await createTestOrg();
  const other = await createTestOrg();
  const customer = await createCustomer(org.orgId);
  const otherCustomer = await createCustomer(other.orgId);
  const now = new Date('2026-10-07T12:00:00Z');
  try {
    const ids: string[] = [];
    for (const [index, days] of [null, -1, 1, 30.9, 31, 60.9, 61, 90.9, 91].entries()) {
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: customer, number: `AGING-${index}`, issueDate: now, dueDate: days === null ? null : new Date(now.getTime() - days * 86400000), status: 'SENT', subtotal: 100, totalAmount: 100 } });
      ids.push(invoice.id);
    }
    await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: customer, number: 'AGING-PAY', date: now, method: 'CASH', status: 'COMPLETED', totalAmount: 30, allocations: { create: { invoiceId: ids[2], amountApplied: 30, discountAmount: 10 } } } });
    await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: customer, number: 'AGING-VOID-PAY', date: now, method: 'CASH', status: 'VOID', totalAmount: 100, allocations: { create: { invoiceId: ids[3], amountApplied: 100 } } } });
    const paid = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: customer, number: 'AGING-PAID', issueDate: now, dueDate: new Date('2025-01-01'), status: 'PAID', subtotal: 100, totalAmount: 100 } });
    await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: customer, number: 'AGING-CLEARED', date: now, method: 'CASH', status: 'COMPLETED', totalAmount: 100, allocations: { create: { invoiceId: paid.id, amountApplied: 100 } } } });
    await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: customer, number: 'AGING-VOID', issueDate: now, dueDate: new Date('2025-01-01'), status: 'VOID', subtotal: 999, totalAmount: 999 } });
    await prisma.salesInvoice.create({ data: { organizationId: other.orgId, customerId: otherCustomer, number: 'AGING-OTHER', issueDate: now, dueDate: new Date('2025-01-01'), status: 'SENT', subtotal: 999, totalAmount: 999 } });
    expect(await dashboardAging(prisma, org.orgId, now)).toEqual({ aging: { current: 200, d1To30: 160, d31To60: 200, d61To90: 200, d90Plus: 100, totalOutstanding: 860 }, overdueInvoiceCount: 7, overdueAmount: 660 });
  } finally {
    // Remove allocations before their invoice/payment parents (RESTRICT FKs).
    await prisma.aRPaymentAllocation.deleteMany({ where: { payment: { organizationId: org.orgId } } });
    await cleanupOrg(org.orgId); await cleanupOrg(other.orgId);
  }
});
