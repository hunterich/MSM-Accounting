import { afterAll, expect, it } from 'vitest';
import { readAgingReport } from '@/lib/aging-report';
import { reportDate } from '@/lib/subledger-history';
import { cleanupOrg, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

it.each(['ar', 'ap'] as const)('preserves %s balances across posting and reversal cutoffs and pages', async (kind) => {
  const { orgId, accounts } = await createTestOrg();
  const ar = kind === 'ar';
  const day = (date: string) => new Date(date + 'T00:00:00Z');
  try {
    const createParty = async (code: string, name: string, openingBalance = 0) => {
      const data = { organizationId: orgId, code, name, openingBalance };
      return ar ? prisma.customer.create({ data }) : prisma.vendor.create({ data });
    };
    const party = await createParty('AGING', 'Selected aging party', 100);
    const other = await createParty('OTHER', 'Other party');
    const createDoc = async (number: string, totalAmount: number, voided = false, partyId = party.id) => {
      const data = { organizationId: orgId, number, issueDate: day('2026-01-01'),
        dueDate: day('2026-01-07'), subtotal: totalAmount, totalAmount };
      return ar
        ? prisma.salesInvoice.create({ data: { ...data, customerId: partyId, status: voided ? 'VOID' : 'SENT' } })
        : prisma.bill.create({ data: { ...data, vendorId: partyId, status: voided ? 'VOID' : 'OPEN' } });
    };
    const principal = await createDoc('MAIN', 1000);
    const principalDue = new Date('2026-01-07T17:00:00Z');
    if (ar) await prisma.salesInvoice.update({ where: { id: principal.id }, data: { dueDate: principalDue } });
    else await prisma.bill.update({ where: { id: principal.id }, data: { dueDate: principalDue } });
    const overpaid = await createDoc('OVERPAID', 100);
    await createDoc('DOC-VOID', 200, true);
    await createDoc('AMBIGUOUS', 60, true);
    await createDoc('MISSING', 40, true);
    await createDoc('OTHER-PARTY', 90, false, other.id);

    const journal = (entryNo: string, date: Date, memo: string, reversal = false, control?: number) =>
      prisma.journalEntry.create({ data: {
        organizationId: orgId, entryNo, date, memo, source: reversal ? 'REVERSAL' : 'SYSTEM', status: 'POSTED',
        ...(control === undefined ? {} : { lines: { create: {
          lineNo: 1, accountId: ar ? accounts.arControl : accounts.apControl, description: memo,
          credit: ar ? control : 0, debit: ar ? 0 : control,
        } } }),
      } });
    for (const [entryNo, date, number] of [
      ['D1', '2026-01-18', 'DOC-VOID'], ['D2', '2026-01-18', 'DOC-VOID'],
      ['D3', '2026-01-18', 'AMBIGUOUS'], ['D4', '2026-01-28', 'AMBIGUOUS'],
    ]) await journal(entryNo, day(date), 'Void ' + (ar ? 'invoice' : 'bill') + ': ' + number, true);

    const allocate = async (number: string, documentId: string, totalAmount: number, amountApplied: number,
      journalEntryId: string | undefined, voided = false, discountAmount = 0, penaltyAmount = 0) => {
      const data = { organizationId: orgId, number, totalAmount, journalEntryId, date: day('2026-01-05'),
        status: voided ? 'VOID' as const : 'COMPLETED' as const };
      const allocation = { amountApplied, discountAmount, penaltyAmount };
      return ar
        ? prisma.aRPayment.create({ data: { ...data, customerId: party.id, allocations: { create: { ...allocation, invoiceId: documentId } } } })
        : prisma.aPPayment.create({ data: { ...data, vendorId: party.id, allocations: { create: { ...allocation, billId: documentId } } } });
    };
    const settlement = ar ? 'AR settlement - ' : 'AP settlement - ';
    const partial = await journal('P1', day('2026-01-05'), settlement + 'PARTIAL', false, 416);
    await allocate('PARTIAL', principal.id, 400, 350, partial.id, false, 20, 5);
    const reversed = await journal('P2', day('2026-01-05'), settlement + 'PAY-VOID', false, 120);
    await prisma.journalLine.create({ data: {
      entryId: reversed.id, lineNo: 2, accountId: ar ? accounts.arControl : accounts.apControl,
      description: settlement + 'PAY-VOID', credit: ar ? 1 : 0, debit: ar ? 0 : 1,
    } });
    await allocate('PAY-VOID', principal.id, 120, 120, reversed.id, true);
    await journal('P3', reportDate('2026-01-14', true), 'Void ' + (ar ? 'AR receipt' : 'AP payment') + ': PAY-VOID', true);
    const later = await journal('P4', day('2026-01-22'), settlement + 'POSTED-LATER', false, 50);
    await allocate('POSTED-LATER', principal.id, 50, 50, later.id);
    await allocate('OVER', overpaid.id, 150, 150, undefined);

    const addNote = async (number: string, amount: number, date: Date, voided = false) => {
      const posted = await journal('J-' + number, date, (ar ? 'AR reduction - ' : 'AP reduction - ') + number);
      const data = { organizationId: orgId, number, amount, date, journalEntryId: posted.id,
        status: voided ? 'VOID' as const : 'APPLIED' as const };
      if (ar) {
        const returned = await prisma.salesReturn.create({ data: { organizationId: orgId, number, customerId: party.id,
          invoiceId: principal.id, returnDate: date, totalAmount: amount, status: 'APPLIED' } });
        await prisma.creditNote.create({ data: { ...data, customerId: party.id, sourceInvoiceId: principal.id, salesReturnId: returned.id } });
      } else {
        const returned = await prisma.purchaseReturn.create({ data: { organizationId: orgId, number, vendorId: party.id,
          billId: principal.id, returnDate: date, totalAmount: amount, status: 'APPLIED' } });
        await prisma.debitNote.create({ data: { ...data, vendorId: party.id, sourceBillId: principal.id, purchaseReturnId: returned.id } });
      }
    };
    await addNote('CREDIT-LATER', 100, day('2026-01-12'));
    await addNote('NOTE-VOID', 30, day('2026-01-07'), true);
    await journal('N1', day('2026-01-15'), 'Void ' + (ar ? 'credit note' : 'debit note') + ': NOTE-VOID', true);

    const aging = (date: string, page = 1, exportAll = false, partySearch = 'Selected aging') =>
      readAgingReport(prisma, kind, { organizationId: orgId, asOf: reportDate(date, true), partySearch, page, limit: 2, exportAll });
    const initial = await aging('2026-01-10');
    expect(initial.total).toBe(3);
    expect(initial.rows.map(row => row.balance)).toEqual([200, 480]);
    expect(initial.rows.map(row => row.daysOverdue)).toEqual([3, 2]);
    expect(initial.summary).toMatchObject({ totalOutstanding: 735, unappliedCredits: 50, netOutstanding: 685, current: 55, d1To30: 680 });
    expect(initial.warnings).toHaveLength(3);
    expect(initial.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('ambiguous'), expect.stringContaining('unavailable'), expect.stringContaining('Payment PARTIAL journal'),
    ]));
    const second = await aging('2026-01-10', 2);
    expect(second.rows.map(row => row.balance)).toEqual([55]);
    expect(second.summary).toEqual(initial.summary);
    expect((await aging('2026-01-10', 1, true)).rows).toEqual([...initial.rows, ...second.rows]);
    expect((await aging('2026-01-10', 1, false, '')).summary.totalOutstanding).toBe(825);
    expect((await aging('2026-01-13')).summary.totalOutstanding).toBe(635);
    expect((await aging('2026-01-14')).summary.totalOutstanding).toBe(755);
    expect((await aging('2026-01-16')).summary.totalOutstanding).toBe(785);
    expect((await aging('2026-01-18')).summary.totalOutstanding).toBe(585);
    expect((await aging('2026-01-22')).summary.totalOutstanding).toBe(535);
    expect((await aging('2026-04-08')).summary).toMatchObject({ d61To90: 480, d90Plus: 0 });
    expect((await aging('2026-04-09')).summary.d90Plus).toBe(480);
  } finally {
    if (ar) await prisma.aRPaymentAllocation.deleteMany({ where: { payment: { organizationId: orgId } } });
    else await prisma.aPPaymentAllocation.deleteMany({ where: { payment: { organizationId: orgId } } });
    await prisma.journalLine.deleteMany({ where: { entry: { organizationId: orgId } } });
    await cleanupOrg(orgId);
  }
});
