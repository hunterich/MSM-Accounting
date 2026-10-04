import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect } from './harness';
import { GET as arReport } from '@/src/app/api/v1/reports/ar/route';
import { GET as apReport } from '@/src/app/api/v1/reports/ap/route';
import { GET as glReport } from '@/src/app/api/v1/reports/gl/route';
import { GET as billSettlement } from '@/src/app/api/v1/bills/[id]/settlement/route';
import { postInvoiceSend } from '../../invoice-send-posting';
import { postBillToLedger } from '../../bill-posting';
import { postCreditNoteOnApply } from '../../credit-note-posting';
import { postDebitNoteOnApply } from '../../debit-note-posting';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '../../payment-posting';
import { voidArPayment, voidApPayment } from '../../payment-void';
import { voidCreditNote, voidDebitNote } from '../../note-void';
import { voidInvoice } from '../../invoice-void';
import { voidBill } from '../../bill-void';
import { postJournalEntry } from '../../journal-posting';

afterAll(disconnect);
const date = (day: string) => new Date(`${day}T00:00:00Z`);
function request(orgId: string, query: string) {
  return new NextRequest(`http://localhost/api/v1/reports?${query}`, { headers: { 'x-org-id': orgId, 'x-user-id': 'qa-report-reader', 'x-role-type': 'ADMIN' } });
}
for (const kind of ['ar', 'ap'] as const) {
  it(`${kind.toUpperCase()}: tax notes, refunds, discounts and later voids reconcile statements and aging to the dated control ledger`, async () => {
    const org = await createTestOrg();
    const ar = kind === 'ar';
    try {
      const partyId = ar ? await createCustomer(org.orgId) : await createVendor(org.orgId);
      const extra = async (code: string, name: string, type: 'EXPENSE' | 'REVENUE' | 'LIABILITY') =>
        (await prisma.account.create({ data: { organizationId: org.orgId, code, name, type, normalSide: type === 'EXPENSE' ? 'DEBIT' : 'CREDIT' } })).id;
      const outputTax = await extra('2210', 'Output Tax', 'LIABILITY');
      const returnAccount = await extra('5300', 'Returns', ar ? 'EXPENSE' : 'REVENUE');
      const discountAccount = await extra('5350', 'Settlement discount', ar ? 'EXPENSE' : 'REVENUE');
      const penaltyAccount = await extra('5400', 'Late fee', ar ? 'REVENUE' : 'EXPENSE');
      const doc = ar ? await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: partyId, number: 'QA-INVOICE',
        issueDate: date('2026-09-10'), dueDate: date('2026-09-20'), status: 'SENT', subtotal: 1000, taxAmount: 110, totalAmount: 1110,
        lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: 1000 }] } } })
        : await prisma.bill.create({ data: { organizationId: org.orgId, vendorId: partyId, number: 'QA-BILL',
          issueDate: date('2026-09-10'), dueDate: date('2026-09-20'), status: 'OPEN', subtotal: 1000, taxable: true, taxRate: 11, taxAmount: 110, totalAmount: 1110,
          lines: { create: [{ lineNo: 1, accountId: org.accounts.cogsExpense, description: 'Service', quantity: 1, price: 1000, lineTotal: 1000 }] } }, include: { lines: true } });
      if (ar) await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, doc.id));
      else {
        const bill = await prisma.bill.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: true } });
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      }
      const note = ar ? await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId: partyId, sourceInvoiceId: doc.id,
        number: 'QA-NOTE', date: date('2026-09-12'), status: 'APPLIED', amount: 222, taxAmount: 22, applyTax: true,
        returnAccountId: returnAccount, arAccountId: org.accounts.arControl, taxAccountId: outputTax } })
        : await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId: partyId, sourceBillId: doc.id,
          number: 'QA-NOTE', date: date('2026-09-12'), status: 'APPLIED', amount: 222, taxAmount: 22, applyTax: true,
          returnAccountId: returnAccount, apAccountId: org.accounts.apControl, taxAccountId: org.accounts.apTax } });
      await prisma.$transaction(tx => ar ? postCreditNoteOnApply(tx, note.id) : postDebitNoteOnApply(tx, note.id));
      const refund = ar ? await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId: partyId, sourceInvoiceId: doc.id,
        number: 'QA-REFUND', date: date('2026-09-13'), status: 'APPLIED', amount: 111, taxAmount: 11, applyTax: true,
        settlementType: 'REFUND', settlementAccountId: org.accounts.bankAsset, returnAccountId: returnAccount, taxAccountId: outputTax } })
        : await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId: partyId, sourceBillId: doc.id,
          number: 'QA-REFUND', date: date('2026-09-13'), status: 'APPLIED', amount: 111, taxAmount: 11, applyTax: true,
          settlementType: 'REFUND_FROM_VENDOR', settlementAccountId: org.accounts.bankAsset, returnAccountId: returnAccount, taxAccountId: org.accounts.apTax } });
      await prisma.$transaction(tx => ar ? postCreditNoteOnApply(tx, refund.id) : postDebitNoteOnApply(tx, refund.id));
      const savedRefund = ar ? await prisma.creditNote.findUniqueOrThrow({ where: { id: refund.id } }) : await prisma.debitNote.findUniqueOrThrow({ where: { id: refund.id } });
      const refundLines = await prisma.journalLine.findMany({ where: { entryId: savedRefund.journalEntryId! } });
      expect(refundLines.find(l => l.accountId === org.accounts.bankAsset)).toMatchObject(ar ? { credit: expect.anything() } : { debit: expect.anything() });
      expect(Number(refundLines.find(l => l.accountId === org.accounts.bankAsset)![ar ? 'credit' : 'debit'])).toBe(111);
      expect(refundLines.some(l => l.accountId === org.accounts[ar ? 'arControl' : 'apControl'])).toBe(false);
      const payment = ar ? await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: partyId, number: 'QA-PAY', date: date('2026-09-15'),
        status: 'COMPLETED', totalAmount: 500, discountAccountId: discountAccount, penaltyAccountId: penaltyAccount,
        allocations: { create: [{ invoiceId: doc.id, amountApplied: 490, discountAmount: 50, penaltyAmount: 10 }] } } })
        : await prisma.aPPayment.create({ data: { organizationId: org.orgId, vendorId: partyId, number: 'QA-PAY', date: date('2026-09-15'),
          status: 'COMPLETED', totalAmount: 500, discountAccountId: discountAccount, penaltyAccountId: penaltyAccount,
          allocations: { create: [{ billId: doc.id, amountApplied: 490, discountAmount: 50, penaltyAmount: 10 }] } } });
      await prisma.$transaction(tx => ar ? postArPaymentIfNeeded(tx, org.orgId, payment.id) : postApPaymentIfNeeded(tx, org.orgId, payment.id));
      if (!ar) {
        const settlement = await billSettlement(request(org.orgId, ''), { params: Promise.resolve({ id: doc.id }) });
        expect(await settlement.json()).toMatchObject({ returned: 222, paid: 540, owing: 348 });
      }
      const getReport = ar ? arReport : apReport;
      async function check(asOf: string, expected: number) {
        const agingResponse = await getReport(request(org.orgId, `type=aging&asOfDate=${asOf}`));
        expect(agingResponse.status).toBe(200);
        const aging = await agingResponse.json();
        expect(aging.summary.totalOutstanding).toBe(expected);
        const statementResponse = await getReport(request(org.orgId, `type=statement&${ar ? 'customerId' : 'vendorId'}=${partyId}&dateFrom=2026-09-01&dateTo=${asOf}`));
        const statement = await statementResponse.json();
        expect(statement.summary.closingBalance).toBe(expected);
        expect(Object.values(statement.summary.aging).reduce((s: number, n) => s + Number(n), 0)).toBe(expected);
        const lines = await prisma.journalLine.aggregate({ where: { accountId: org.accounts[ar ? 'arControl' : 'apControl'], entry: {
          organizationId: org.orgId, status: 'POSTED', date: { lte: new Date(`${asOf}T23:59:59.999Z`) } } }, _sum: { debit: true, credit: true } });
        const gl = ar ? Number(lines._sum.debit) - Number(lines._sum.credit) : Number(lines._sum.credit) - Number(lines._sum.debit);
        expect(gl).toBe(expected);
      }
      await check('2026-09-09', 0);
      await check('2026-09-11', 1110);
      await check('2026-09-12', 888);
      await check('2026-09-30', 348);
      await prisma.$transaction(tx => ar ? voidArPayment(tx, org.orgId, payment.id, { date: date('2026-10-02') }) : voidApPayment(tx, org.orgId, payment.id, { date: date('2026-10-02') }));
      await check('2026-09-30', 348);
      await check('2026-10-02', 888);
      await expect(prisma.$transaction(tx => ar ? voidInvoice(tx, org.orgId, doc.id, { date: date('2026-10-03') }) : voidBill(tx, org.orgId, doc.id, { date: date('2026-10-03') }))).rejects.toThrow(/applied.*notes/i);
      await check('2026-10-02', 888);
      await prisma.$transaction(tx => ar ? voidCreditNote(tx, org.orgId, note.id, { date: date('2026-10-03') }) : voidDebitNote(tx, org.orgId, note.id, { date: date('2026-10-03') }));
      await check('2026-10-03', 1110);
      await prisma.$transaction(tx => ar ? voidInvoice(tx, org.orgId, doc.id, { date: date('2026-10-04') }) : voidBill(tx, org.orgId, doc.id, { date: date('2026-10-04') }));
      await check('2026-09-30', 348);
      await check('2026-10-04', 0);
      const october = await (await getReport(request(org.orgId, `type=statement&${ar ? 'customerId' : 'vendorId'}=${partyId}&dateFrom=2026-10-01&dateTo=2026-10-04`))).json();
      expect(october.openingBalance).toBe(348);
      expect(october.summary.closingBalance).toBe(0);
      expect(october.rows.map((r: { type: string }) => r.type)).toEqual(['Void Payment', ar ? 'Void Credit Note' : 'Void Debit Note', ar ? 'Void Invoice' : 'Void Bill']);
      // Simulate a legacy void that permanently deleted its allocation rows.
      if (ar) await prisma.aRPaymentAllocation.deleteMany({ where: { paymentId: payment.id } });
      else await prisma.aPPaymentAllocation.deleteMany({ where: { paymentId: payment.id } });
      const legacy = await (await getReport(request(org.orgId, 'type=aging&asOfDate=2026-09-30'))).json();
      expect(legacy.warnings).toContain('Historical allocation unavailable for voided payment QA-PAY');
    } finally { await cleanupOrg(org.orgId); }
  });
}

it('AR and trial balance use the same Jakarta midnight cutoff', async () => {
  const org = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    for (const [number, issueDate, totalAmount] of [
      ['BEFORE-MIDNIGHT', new Date('2026-09-30T16:59:59.999Z'), 200],
      ['AT-MIDNIGHT', new Date('2026-09-30T17:00:00.000Z'), 300],
    ] as const) {
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate, totalAmount, subtotal: totalAmount, status: 'SENT' } });
      await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
    }
    for (const [asOf, expected] of [['2026-09-30', 200], ['2026-10-01', 500]] as const) {
      const aging = await (await arReport(request(org.orgId, `type=aging&asOfDate=${asOf}`))).json();
      expect(aging.summary.totalOutstanding).toBe(expected);
      const trialBalance = await (await glReport(request(org.orgId, `type=trial-balance&asOfDate=${asOf}`))).json();
      expect(trialBalance.rows.find((r: { accountCode: string }) => r.accountCode === '1210').endingDebit).toBe(expected);
      expect(trialBalance.summary.totalDebit).toBe(trialBalance.summary.totalCredit);
    }
  } finally { await cleanupOrg(org.orgId); }
});

for (const kind of ['ar', 'ap'] as const) {
  it(`${kind.toUpperCase()}: paid documents remain in earlier snapshots; opening balances and unapplied payments reconcile`, async () => {
    const org = await createTestOrg();
    const ar = kind === 'ar';
    try {
      const partyId = ar ? await createCustomer(org.orgId) : await createVendor(org.orgId);
      if (ar) await prisma.customer.update({ where: { id: partyId }, data: { openingBalance: 500 } });
      else await prisma.vendor.update({ where: { id: partyId }, data: { openingBalance: 500 } });
      const control = org.accounts[ar ? 'arControl' : 'apControl'];
      await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: org.orgId, date: date('2026-08-01'), memo: 'Opening balance', lines: [
        { accountId: control, description: 'Opening debt', debit: ar ? 500 : 0, credit: ar ? 0 : 500 },
        { accountId: org.accounts.openingBalanceEquity, description: 'Opening equity', debit: ar ? 0 : 500, credit: ar ? 500 : 0 },
      ] }));
      const doc = ar ? await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: partyId, number: 'PAID-LATER', issueDate: date('2026-09-10'), status: 'PAID', totalAmount: 1000, subtotal: 1000 } })
        : await prisma.bill.create({ data: { organizationId: org.orgId, vendorId: partyId, number: 'PAID-LATER', issueDate: date('2026-09-10'), status: 'PAID', totalAmount: 1000, subtotal: 1000,
          lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: 1000, lineTotal: 1000, accountId: org.accounts.cogsExpense }] } }, include: { lines: true } });
      if (ar) await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, doc.id));
      else {
        const bill = await prisma.bill.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: true } });
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      }
      const payment = ar ? await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: partyId, number: 'PAID-OCT', date: date('2026-10-01'), status: 'COMPLETED', totalAmount: 1000,
        allocations: { create: [{ invoiceId: doc.id, amountApplied: 1000 }] } } })
        : await prisma.aPPayment.create({ data: { organizationId: org.orgId, vendorId: partyId, number: 'PAID-OCT', date: date('2026-10-01'), status: 'COMPLETED', totalAmount: 1000,
          allocations: { create: [{ billId: doc.id, amountApplied: 1000 }] } } });
      await prisma.$transaction(tx => ar ? postArPaymentIfNeeded(tx, org.orgId, payment.id) : postApPaymentIfNeeded(tx, org.orgId, payment.id));
      const unallocated = ar ? await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: partyId, number: 'UNAPPLIED', date: date('2026-10-02'), status: 'COMPLETED', totalAmount: 200 } })
        : await prisma.aPPayment.create({ data: { organizationId: org.orgId, vendorId: partyId, number: 'UNAPPLIED', date: date('2026-10-02'), status: 'COMPLETED', totalAmount: 200 } });
      await prisma.$transaction(tx => ar ? postArPaymentIfNeeded(tx, org.orgId, unallocated.id) : postApPaymentIfNeeded(tx, org.orgId, unallocated.id));
      const report = ar ? arReport : apReport;
      for (const [asOf, expected] of [['2026-09-30', 1500], ['2026-10-01', 500], ['2026-10-02', 300]] as const) {
        const aging = await (await report(request(org.orgId, `type=aging&asOfDate=${asOf}`))).json();
        expect(aging.summary.netOutstanding).toBe(expected);
        const balance = await (await report(request(org.orgId, `type=${ar ? 'customer-balance' : 'vendor-balance'}&asOfDate=${asOf}`))).json();
        expect(balance.summary.totalOutstanding).toBe(expected);
        const statement = await (await report(request(org.orgId, `type=statement&${ar ? 'customerId' : 'vendorId'}=${partyId}&dateFrom=2026-09-01&dateTo=${asOf}`))).json();
        expect(statement.summary.closingBalance).toBe(expected);
        const lines = await prisma.journalLine.aggregate({ where: { accountId: control, entry: { organizationId: org.orgId, status: 'POSTED', date: { lte: new Date(`${asOf}T16:59:59.999Z`) } } }, _sum: { debit: true, credit: true } });
        expect(ar ? Number(lines._sum.debit) - Number(lines._sum.credit) : Number(lines._sum.credit) - Number(lines._sum.debit)).toBe(expected);
      }
      const advance = ar ? await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId: partyId, number: 'CREDIT-BALANCE', date: date('2026-10-03'), status: 'COMPLETED', totalAmount: 500 } })
        : await prisma.aPPayment.create({ data: { organizationId: org.orgId, vendorId: partyId, number: 'CREDIT-BALANCE', date: date('2026-10-03'), status: 'COMPLETED', totalAmount: 500 } });
      await prisma.$transaction(tx => ar ? postArPaymentIfNeeded(tx, org.orgId, advance.id) : postApPaymentIfNeeded(tx, org.orgId, advance.id));
      const creditAging = await (await report(request(org.orgId, 'type=aging&asOfDate=2026-10-03'))).json();
      expect(creditAging.summary).toMatchObject({ totalOutstanding: 0, unappliedCredits: 200, netOutstanding: -200 });
      const creditBalance = await (await report(request(org.orgId, `type=${ar ? 'customer-balance' : 'vendor-balance'}&asOfDate=2026-10-03`))).json();
      expect(creditBalance.summary.totalOutstanding).toBe(-200);
    } finally { await cleanupOrg(org.orgId); }
  });
}
