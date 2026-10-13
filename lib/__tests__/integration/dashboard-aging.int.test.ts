import { afterAll, expect, it } from 'vitest';
import { dashboardAging } from '@/lib/dashboard-aging';
import { readDashboardSales } from '@/lib/dashboard-sales';
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
    for (const [index, days] of [null, -1, 1, 30, 31, 60, 61, 90, 91].entries()) {
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: customer, number: `AGING-${index}`, issueDate: now, dueDate: days === null ? null : new Date(Date.parse('2026-10-07T00:00:00Z') - days * 86400000), status: 'SENT', subtotal: 100, totalAmount: 100 } });
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

it('includes applied note gross amounts once, excludes refunds/pending/void notes, and agrees with sales at Jakarta midnight', async () => {
  const org = await createTestOrg();
  const other = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const now = new Date('2026-10-07T17:01:00Z'); // October 8, 00:01 WIB.
    const make = (number: string, dueDate: string) => prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number,
      issueDate: new Date('2026-10-01'), dueDate: new Date(dueDate), status: 'SENT', subtotal: 100, totalAmount: 100 } });
    const yesterday = await make('AGING-NOTE-YESTERDAY', '2026-10-07');
    const today = await make('AGING-NOTE-TODAY', '2026-10-08');
    const full = await make('AGING-NOTE-FULL', '2026-10-07');
    await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId, number: 'AGING-NOTE-PAY', date: now, method: 'CASH', status: 'COMPLETED', totalAmount: 20,
      allocations: { create: { invoiceId: yesterday.id, amountApplied: 20, discountAmount: 10 } } } });
    const note = (number: string, sourceInvoiceId: string, amount: number, status: 'APPLIED' | 'DRAFT' | 'PENDING_APPROVAL' | 'VOID', settlementType: 'APPLY_TO_INVOICE' | 'REFUND', organizationId = org.orgId) =>
      prisma.creditNote.create({ data: { organizationId, customerId, number, sourceInvoiceId, date: now, amount, status, settlementType, applyTax: true, taxAmount: 5 } });
    await note('CN-PARTIAL', yesterday.id, 40, 'APPLIED', 'APPLY_TO_INVOICE');
    await note('CN-FULL', full.id, 100, 'APPLIED', 'APPLY_TO_INVOICE');
    await note('CN-REFUND', today.id, 80, 'APPLIED', 'REFUND');
    await note('CN-DRAFT', today.id, 80, 'DRAFT', 'APPLY_TO_INVOICE');
    await note('CN-PENDING', today.id, 80, 'PENDING_APPROVAL', 'APPLY_TO_INVOICE');
    await note('CN-VOID', today.id, 80, 'VOID', 'APPLY_TO_INVOICE');
    await note('CN-FOREIGN', today.id, 80, 'APPLIED', 'APPLY_TO_INVOICE', other.orgId);
    const aging = await dashboardAging(prisma, org.orgId, now);
    expect(aging).toEqual({ aging: { current: 100, d1To30: 30, d31To60: 0, d61To90: 0, d90Plus: 0, totalOutstanding: 130 }, overdueInvoiceCount: 1, overdueAmount: 30 });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
      expect(await dashboardAging(tx, org.orgId, now)).toEqual(aging);
    });
    const sales = await readDashboardSales(prisma, org.orgId, new Date('2026-10-01'), now,
      new Date('2026-10-07T17:00:00Z'), new Date('2026-10-08T16:59:59.999Z'));
    expect(sales.current).toBe(aging.aging.current);
    expect(sales.overdue).toBe(aging.overdueAmount);
    expect(sales.outstanding).toBe(aging.aging.totalOutstanding);
    await prisma.creditNote.update({ where: { organizationId_number: { number: 'CN-PARTIAL', organizationId: org.orgId } }, data: { status: 'VOID' } });
    expect((await dashboardAging(prisma, org.orgId, now)).overdueAmount).toBe(70);
    expect((await dashboardAging(prisma, org.orgId, new Date('2026-10-07T16:59:00Z'))).overdueInvoiceCount).toBe(0);
  } finally {
    await prisma.creditNote.deleteMany({ where: { organizationId: { in: [org.orgId, other.orgId] } } });
    await prisma.aRPaymentAllocation.deleteMany({ where: { payment: { organizationId: org.orgId } } });
    await cleanupOrg(org.orgId); await cleanupOrg(other.orgId);
  }
});
