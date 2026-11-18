import { afterAll, expect, it } from 'vitest';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { postCreditNoteOnApply } from '@/lib/credit-note-posting';
import { voidCreditNote } from '@/lib/note-void';
import { voidInvoice } from '@/lib/invoice-void';
import { readCustomerSales, readItemSales, readItemCustomerSales, readSalesCalendar, readSalesHistory, readSalesWarnings } from '@/lib/sales-summary';
import { buildProfitLossReport } from '@/lib/gl-reporting';
import { readJournalTotals } from '@/lib/journal-totals';
import { cleanupOrg, createCustomer, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

it('reconciles tax-exclusive invoice and linked return to the P&L', async () => {
  const org = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const tax = await prisma.account.create({ data: { organizationId: org.orgId, code: '2201', name: 'Output tax', type: 'LIABILITY', normalSide: 'CREDIT' } });
    const returns = await prisma.account.create({ data: { organizationId: org.orgId, code: '5201', name: 'Sales returns', type: 'EXPENSE', normalSide: 'DEBIT' } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: { ...org.accounts, arTax: tax.id, arReturn: returns.id } } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'SERVICE-1', name: 'Service', type: 'SERVICE' } });
    const invoiceDate = new Date('2026-01-10T00:00:00Z');
    const returnDate = new Date('2026-01-20T00:00:00Z');
    const invoice = await prisma.salesInvoice.create({ data: {
      organizationId: org.orgId, customerId, number: 'INV-240', issueDate: invoiceDate, status: 'SENT',
      subtotal: 600000, taxEnabled: true, taxRate: 11, taxAmount: 66000, totalAmount: 666000,
      lines: { create: { itemId: item.id, lineNo: 1, description: 'Service', quantity: 4, price: 150000, lineSubtotal: 600000 } },
    }, include: { lines: true } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
    const ret = await prisma.salesReturn.create({ data: {
      organizationId: org.orgId, customerId, invoiceId: invoice.id, number: 'RET-240', returnDate, status: 'APPROVED',
      applyTax: true, taxRate: 11, subtotal: 150000, taxAmount: 16500, totalAmount: 166500,
      lines: { create: { itemId: item.id, sourceInvoiceLineId: invoice.lines[0].id, lineNo: 1, itemName: 'Service', qtySold: 4, qtyReturn: 1, price: 150000, lineTotal: 150000, goodsReceived: false } },
    } });
    await prisma.$transaction(tx => postSalesReturnOnApproval(tx, ret.id));
    const note = await prisma.creditNote.create({ data: {
      organizationId: org.orgId, customerId, sourceInvoiceId: invoice.id, salesReturnId: ret.id, number: 'CN-240',
      date: returnDate, status: 'APPLIED', amount: 111000, taxAmount: 11000, applyTax: true,
      returnAccountId: returns.id, taxAccountId: tax.id,
    } });
    await prisma.$transaction(tx => postCreditNoteOnApply(tx, note.id));
    const secondNote = await prisma.creditNote.create({ data: {
      organizationId: org.orgId, customerId, sourceInvoiceId: invoice.id, salesReturnId: ret.id, number: 'CN-240-2',
      date: returnDate, status: 'APPLIED', amount: 55500, taxAmount: 5500, applyTax: true,
      returnAccountId: returns.id, taxAccountId: tax.id,
    } });
    await prisma.$transaction(tx => postCreditNoteOnApply(tx, secondNote.id));
    const filter = { organizationId: org.orgId, excludeTax: true, dateFrom: new Date('2026-01-01T00:00:00Z'), dateTo: new Date('2026-01-31T23:59:59Z') };
    const accounts = await prisma.account.findMany({ where: { organizationId: org.orgId } });
    const totals = await readJournalTotals(prisma, { entry: { organizationId: org.orgId, status: 'POSTED', date: { gte: filter.dateFrom, lte: filter.dateTo } } });
    const pl = buildProfitLossReport(accounts, totals);
    const returnExpense = pl.sections.find(section => section.id === 'EXPENSE')?.rows.find(row => row.accountId === returns.id)?.amount ?? 0;
    const netSales = pl.summary.totalRevenue - returnExpense;
    expect(netSales).toBe(450000);
    expect((await readCustomerSales(prisma, filter)).reduce((sum, row) => sum + row.total, 0)).toBe(netSales);
    const items = await readItemSales(prisma, filter);
    expect(items.reduce((sum, row) => sum + row.total, 0)).toBe(netSales);
    expect(items).toContainEqual(expect.objectContaining({ code: 'SERVICE-1', qty: 3, returnedQty: 1, total: 450000 }));
    expect((await readItemCustomerSales(prisma, filter)).reduce((sum, row) => sum + row.total, 0)).toBe(netSales);
    expect((await readSalesCalendar(prisma, filter, 'month')).reduce((sum, row) => sum + row.total, 0)).toBe(netSales);
    expect((await readSalesHistory(prisma, filter, 100)).reduce((sum, row) => sum + row.totalAmount, 0)).toBe(netSales);
    const adjustment = await prisma.creditNote.create({ data: {
      organizationId: org.orgId, customerId, number: 'CN-UNALLOCATED', date: new Date('2026-02-10T00:00:00Z'),
      status: 'APPLIED', amount: 22200, taxAmount: 2200, applyTax: true, settlementType: 'REFUND',
      settlementAccountId: org.accounts.bankAsset, returnAccountId: returns.id, taxAccountId: tax.id,
    } });
    await prisma.$transaction(tx => postCreditNoteOnApply(tx, adjustment.id));
    const february = { ...filter, dateFrom: new Date('2026-02-01T00:00:00Z'), dateTo: new Date('2026-02-28T23:59:59Z') };
    expect((await readCustomerSales(prisma, february)).reduce((sum, row) => sum + row.total, 0)).toBe(-20000);
    expect(await readItemSales(prisma, february)).toContainEqual(expect.objectContaining({
      description: 'Unallocated credit notes', qty: 0, returnedQty: 0, total: -20000,
    }));
    await prisma.$transaction(tx => voidCreditNote(tx, org.orgId, adjustment.id, { date: new Date('2026-03-05T00:00:00Z') }));
    expect((await readCustomerSales(prisma, february)).reduce((sum, row) => sum + row.total, 0)).toBe(-20000);
    expect((await readItemSales(prisma, february)).reduce((sum, row) => sum + row.total, 0)).toBe(-20000);
    const march = { ...filter, dateFrom: new Date('2026-03-01T00:00:00Z'), dateTo: new Date('2026-03-31T23:59:59Z') };
    expect((await readCustomerSales(prisma, march)).reduce((sum, row) => sum + row.total, 0)).toBe(20000);
    expect((await readItemSales(prisma, march)).reduce((sum, row) => sum + row.total, 0)).toBe(20000);
    const laterInvoice = await prisma.salesInvoice.create({ data: {
      organizationId: org.orgId, customerId, number: 'INV-VOID-240', issueDate: new Date('2026-02-11T00:00:00Z'),
      status: 'SENT', subtotal: 100, totalAmount: 100, taxEnabled: false,
      lines: { create: { itemId: item.id, lineNo: 1, description: 'Service', quantity: 1, price: 100, lineSubtotal: 100 } },
    } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, laterInvoice.id));
    await prisma.$transaction(tx => voidInvoice(tx, org.orgId, laterInvoice.id, { date: new Date('2026-03-06T00:00:00Z') }));
    expect((await readCustomerSales(prisma, february)).reduce((sum, row) => sum + row.total, 0)).toBe(-19900);
    expect((await readItemSales(prisma, february)).reduce((sum, row) => sum + row.total, 0)).toBe(-19900);
    expect((await readCustomerSales(prisma, march)).reduce((sum, row) => sum + row.total, 0)).toBe(19900);
    expect((await readItemSales(prisma, march)).reduce((sum, row) => sum + row.total, 0)).toBe(19900);
    for (const [period, expected] of [[february, -19900], [march, 19900]] as const) {
      const ledger = await readJournalTotals(prisma, { entry: { organizationId: org.orgId, status: 'POSTED',
        date: { gte: period.dateFrom, lte: period.dateTo } } });
      const periodPl = buildProfitLossReport(accounts, ledger);
      const periodReturns = periodPl.sections.find(section => section.id === 'EXPENSE')?.rows.find(row => row.accountId === returns.id)?.amount ?? 0;
      expect(periodPl.summary.totalRevenue - periodReturns).toBe(expected);
    }
    const missingJournal = await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId,
      number: 'LEGACY-240', date: returnDate, status: 'APPLIED', amount: 10 } });
    expect(await readSalesWarnings(prisma, org.orgId)).toEqual(expect.arrayContaining([
      expect.stringContaining('LEGACY-240'),
    ]));
    await prisma.creditNote.delete({ where: { id: missingJournal.id } });
  } finally {
    await cleanupOrg(org.orgId);
  }
});
