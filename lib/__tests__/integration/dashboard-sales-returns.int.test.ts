import { afterAll, expect, it } from 'vitest';
import { readDashboardSales } from '@/lib/dashboard-sales';
import { readCustomerSales, readSalesCalendar } from '@/lib/sales-summary';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect } from './harness';
afterAll(disconnect);

it('net sales recognize applied gross credit notes in their own Jakarta month without treating returns as payments', async () => {
  const org = await createTestOrg();
  const other = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const invoice = (number: string, issueDate: string, totalAmount: number, status: 'SENT' | 'PAID' | 'DRAFT' = 'SENT') =>
      prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: new Date(issueDate), dueDate: new Date(issueDate), status, subtotal: totalAmount, totalAmount } });
    const returned = await invoice('FULL-RETURN', '2026-01-10', 111);
    const paid = await invoice('LATER-REFUND', '2026-01-15', 111, 'PAID');
    const partial = await invoice('FEB-PARTIAL', '2026-02-10', 222);
    const draft = await invoice('DRAFT-INVOICE', '2026-02-10', 111, 'DRAFT');
    const note = (number: string, sourceInvoiceId: string | null, date: string, amount: number,
      settlementType: 'REFUND' | 'APPLY_TO_INVOICE' = 'APPLY_TO_INVOICE',
      status: 'APPLIED' | 'DRAFT' | 'PENDING_APPROVAL' | 'VOID' = 'APPLIED', organizationId = org.orgId) =>
      prisma.creditNote.create({ data: { organizationId, customerId, number, sourceInvoiceId, date: new Date(date), amount, taxAmount: 11, applyTax: true, settlementType, status } });
    await note('JAN-RETURN', returned.id, '2026-01-20', 111);
    await note('FEB-REFUND', paid.id, '2026-02-10', 111, 'REFUND');
    await note('FEB-PARTIAL-CREDIT', partial.id, '2026-02-20', 11);
    await note('FEB-STANDALONE-REFUND', null, '2026-02-20', 22, 'REFUND');
    await note('MARCH-WIB-BOUNDARY', partial.id, '2026-02-28T17:00:00Z', 1);
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'VOID'] as const) await note('EXCLUDE-' + status, partial.id, '2026-02-15', 99, 'APPLY_TO_INVOICE', status);
    await note('EXCLUDE-FOREIGN', partial.id, '2026-02-15', 99, 'APPLY_TO_INVOICE', 'APPLIED', other.orgId);
    await note('EXCLUDE-DRAFT-SOURCE', draft.id, '2026-02-15', 99);
    await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId, number: 'JAN-CASH', date: new Date('2026-01-25'), totalAmount: 111, status: 'COMPLETED',
      allocations: { create: { invoiceId: paid.id, amountApplied: 111 } } } });
    await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId, number: 'FEB-CASH', date: new Date('2026-02-25'), totalAmount: 100, status: 'COMPLETED',
      allocations: { create: { invoiceId: partial.id, amountApplied: 100, discountAmount: 11 } } } });
    const janFrom = new Date('2025-12-31T17:00:00Z'), janTo = new Date('2026-01-31T16:59:59.999Z');
    const febFrom = new Date('2026-01-31T17:00:00Z'), febTo = new Date('2026-02-28T16:59:59.999Z');
    const jan = await readDashboardSales(prisma, org.orgId, janFrom, janTo, new Date('2026-01-30T17:00:00Z'), janTo);
    expect(jan).toMatchObject({ grossSales: 222, returns: 111, sales: 111, paid: 111, unpaid: 0, outstanding: 0 });
    const feb = await readDashboardSales(prisma, org.orgId, febFrom, febTo, new Date('2026-02-27T17:00:00Z'), febTo);
    expect(feb).toMatchObject({ grossSales: 222, returns: 144, sales: 78, paid: 111, unpaid: 100, outstanding: 100 });
    const janNow = await readDashboardSales(prisma, org.orgId, janFrom, janTo, new Date('2026-02-27T17:00:00Z'), febTo);
    expect(janNow).toMatchObject({ sales: 111, paid: 0, unpaid: 0 }); // Later refund changes settlement, not January sales.
    const januaryCustomers = await readCustomerSales(prisma, { organizationId: org.orgId, dateFrom: janFrom, dateTo: janTo });
    expect(januaryCustomers[0]).toMatchObject({ invoiceCount: 2, total: jan.sales });
    const februaryCustomers = await readCustomerSales(prisma, { organizationId: org.orgId, dateFrom: febFrom, dateTo: febTo });
    expect(februaryCustomers[0]).toMatchObject({ invoiceCount: 1, total: feb.sales });
    const calendar = await readSalesCalendar(prisma, { organizationId: org.orgId }, 'month', customerId);
    expect(calendar).toEqual([
      { bucket: '2026-01', invoiceCount: 2, total: 111 },
      { bucket: '2026-02', invoiceCount: 1, total: 78 },
      { bucket: '2026-03', invoiceCount: 0, total: -1 },
    ]);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
      expect(await readSalesCalendar(tx, { organizationId: org.orgId }, 'month', customerId)).toEqual(calendar);
    });
    await prisma.creditNote.update({ where: { id: (await prisma.creditNote.findUniqueOrThrow({ where: { organizationId_number: { organizationId: org.orgId, number: 'FEB-REFUND' } } })).id }, data: { status: 'VOID' } });
    expect((await readCustomerSales(prisma, { organizationId: org.orgId, dateFrom: febFrom, dateTo: febTo }))[0].total).toBe(189);
  } finally {
    await prisma.creditNote.deleteMany({ where: { organizationId: { in: [org.orgId, other.orgId] } } });
    await cleanupOrg(org.orgId); await cleanupOrg(other.orgId);
  }
});
