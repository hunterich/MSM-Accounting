import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect, type TestOrg } from './harness';
import { GET as reconciliationReport } from '@/src/app/api/v1/reports/control-reconciliation/route';
import { GET as arReport } from '@/src/app/api/v1/reports/ar/route';
import { GET as apReport } from '@/src/app/api/v1/reports/ap/route';
import { GET as closeChecklist } from '@/src/app/api/v1/accounting-periods/[id]/close-checklist/route';
import { postInvoiceSend } from '../../invoice-send-posting';
import { postBillToLedger } from '../../bill-posting';
import { postCreditNoteOnApply } from '../../credit-note-posting';
import { postDebitNoteOnApply } from '../../debit-note-posting';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '../../payment-posting';
import { voidInvoice } from '../../invoice-void';
import { voidBill } from '../../bill-void';
import { postJournalEntry } from '../../journal-posting';
import { createBatch, stageEntity } from '../../migration/batch-service';
import { commitBatch, resolveControlCodes } from '../../migration/commit';
import type { ControlReconciliation } from '../../control-reconciliation';

afterAll(disconnect);
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const headers = (orgId: string) => ({ 'x-org-id': orgId, 'x-user-id': 'qa-control-reader', 'x-role-type': 'ADMIN' });
type Kind = 'ar' | 'ap';

async function reconcile(orgId: string, kind: Kind, asOf: string): Promise<ControlReconciliation> {
  const response = await reconciliationReport(new NextRequest(`http://localhost/api/v1/reports/control-reconciliation?kind=${kind}&asOfDate=${asOf}`, { headers: headers(orgId) }));
  expect(response.status).toBe(200);
  return response.json();
}
async function agingNet(orgId: string, kind: Kind, asOf: string): Promise<number> {
  const report = kind === 'ar' ? arReport : apReport;
  const aging = await (await report(new NextRequest(`http://localhost/api/v1/reports?type=aging&asOfDate=${asOf}`, { headers: headers(orgId) }))).json();
  return aging.summary.netOutstanding;
}
/** Independent per-account GL in the control's natural sign, Jakarta end of day. */
async function gl(orgId: string, kind: Kind, accountId: string, asOf: string): Promise<number> {
  const sum = await prisma.journalLine.aggregate({ where: { accountId, entry: { organizationId: orgId, status: 'POSTED', date: { lte: new Date(`${asOf}T16:59:59.999Z`) } } }, _sum: { debit: true, credit: true } });
  const debitNormal = Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0);
  return kind === 'ar' ? debitNormal : -debitNormal;
}
const account = (r: ControlReconciliation, accountId: string) => {
  const row = r.accounts.find(a => a.accountId === accountId);
  if (!row) throw new Error(`No reconciliation row for ${accountId}`);
  return row;
};

async function document(org: TestOrg, kind: Kind, partyId: string, number: string, day: string, amount: number,
  opts: { apAccountId?: string; lineAccountId?: string; chargeAccountId?: string; chargeAmount?: number } = {}) {
  if (kind === 'ar') {
    const charge = opts.chargeAmount ?? 0;
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: partyId, number, issueDate: date(day), status: 'SENT',
      subtotal: amount, totalAmount: amount + charge, taxEnabled: false, taxAmount: 0,
      lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: amount }] },
      ...(charge ? { charges: { create: [{ lineNo: 1, label: 'Freight', accountId: opts.chargeAccountId!, amount: charge, taxRate: 0 }] } } : {}) } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
    return invoice.id;
  }
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId: partyId, number, issueDate: date(day), status: 'OPEN',
    subtotal: amount, totalAmount: amount, apAccountId: opts.apAccountId ?? null,
    lines: { create: [{ lineNo: 1, accountId: opts.lineAccountId ?? org.accounts.cogsExpense, description: 'Service', quantity: 1, price: amount, lineTotal: amount }] } }, include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  return bill.id;
}
async function payment(org: TestOrg, kind: Kind, partyId: string, number: string, day: string, total: number,
  allocations: Array<{ documentId: string; applied: number; discount?: number; penalty?: number }>, controlId: string | null, discountAccountId?: string, penaltyAccountId?: string) {
  const rows = allocations.map(a => ({ ...(kind === 'ar' ? { invoiceId: a.documentId } : { billId: a.documentId }), amountApplied: a.applied, discountAmount: a.discount ?? 0, penaltyAmount: a.penalty ?? 0 }));
  const common = { organizationId: org.orgId, number, date: date(day), status: 'COMPLETED' as const, totalAmount: total, discountAccountId, penaltyAccountId };
  if (kind === 'ar') {
    const p = await prisma.aRPayment.create({ data: { ...common, customerId: partyId, arAccountId: controlId, allocations: { create: rows as Array<{ invoiceId: string; amountApplied: number }> } } });
    await prisma.$transaction(tx => postArPaymentIfNeeded(tx, org.orgId, p.id));
    return p.id;
  }
  const p = await prisma.aPPayment.create({ data: { ...common, vendorId: partyId, apAccountId: controlId, allocations: { create: rows as Array<{ billId: string; amountApplied: number }> } } });
  await prisma.$transaction(tx => postApPaymentIfNeeded(tx, org.orgId, p.id));
  return p.id;
}
async function note(org: TestOrg, kind: Kind, partyId: string, number: string, day: string, amount: number, returnAccountId: string, controlId: string | null) {
  if (kind === 'ar') {
    const n = await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId: partyId, number, date: date(day), status: 'APPLIED', amount, taxAmount: 0, applyTax: false, returnAccountId, arAccountId: controlId } });
    await prisma.$transaction(tx => postCreditNoteOnApply(tx, n.id));
    return n.id;
  }
  const n = await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId: partyId, number, date: date(day), status: 'APPLIED', amount, taxAmount: 0, applyTax: false, returnAccountId, apAccountId: controlId } });
  await prisma.$transaction(tx => postDebitNoteOnApply(tx, n.id));
  return n.id;
}

for (const kind of ['ar', 'ap'] as const) {
  it(`${kind.toUpperCase()}: each control account reconciles independently; offsetting manual journals stay named`, async () => {
    const org = await createTestOrg();
    const ar = kind === 'ar';
    try {
      const partyId = ar ? await createCustomer(org.orgId) : await createVendor(org.orgId);
      const extra = async (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EXPENSE' | 'REVENUE') =>
        (await prisma.account.create({ data: { organizationId: org.orgId, code, name, type, normalSide: type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT' } })).id;
      const primary = org.accounts[ar ? 'arControl' : 'apControl'];
      const alternate = ar ? await extra('1215', 'Accounts Receivable - Related Parties', 'ASSET') : await extra('2105', 'Accounts Payable - Imports', 'LIABILITY');
      const returns = await extra('5300', 'Returns and allowances', ar ? 'EXPENSE' : 'REVENUE');
      const discountAccount = await extra('5350', 'Settlement discount', ar ? 'EXPENSE' : 'REVENUE');
      const penaltyAccount = await extra('5400', 'Late fee', ar ? 'REVENUE' : 'EXPENSE');

      const first = await document(org, kind, partyId, 'DOC-1', '2026-09-10', 1110);
      // AR invoices follow the company default; AP bills carry their own override.
      if (ar) await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: { arControl: alternate } } });
      const altControl = ar ? null : alternate;
      await document(org, kind, partyId, 'DOC-2', '2026-09-11', 600, { apAccountId: altControl ?? undefined });
      // Cash 500 + discount 50 - penalty 10 clears 540 from the first control.
      await payment(org, kind, partyId, 'PAY-1', '2026-09-15', 500, [{ documentId: first, applied: 490, discount: 50, penalty: 10 }], primary, discountAccount, penaltyAccount);
      await payment(org, kind, partyId, 'ADVANCE', '2026-09-16', 200, [], altControl);
      await note(org, kind, partyId, 'NOTE-STANDALONE', '2026-09-17', 100, returns, altControl);
      const later = await document(org, kind, partyId, 'DOC-3', '2026-09-20', 300, { apAccountId: altControl ?? undefined });
      await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: org.orgId, date: date('2026-09-25'), memo: 'Historical reclass', source: 'MANUAL', lines: [
        { accountId: primary, description: 'Reclass', debit: ar ? 75 : 0, credit: ar ? 0 : 75 },
        { accountId: alternate, description: 'Reclass', debit: ar ? 0 : 75, credit: ar ? 75 : 0 },
      ] }));

      const september = await reconcile(org.orgId, kind, '2026-09-30');
      const p = account(september, primary);
      const a = account(september, alternate);
      expect(p).toMatchObject({ glBalance: 645, subledgerBalance: 570, difference: 75, subledger: { documents: 1110, settlements: -540, notes: 0, opening: 0 } });
      expect(a).toMatchObject({ isDefault: ar, glBalance: 525, subledgerBalance: 600, difference: -75, subledger: { documents: 900, settlements: -200, notes: -100, opening: 0 } });
      expect(p.items).toEqual([expect.objectContaining({ category: 'UNLINKED_JOURNAL', amount: 75, source: 'MANUAL', message: expect.stringMatching(/Manual journal JE-\d+ \(Historical reclass\)/) })]);
      expect(a.items).toEqual([expect.objectContaining({ category: 'UNLINKED_JOURNAL', amount: -75 })]);
      // The company total hides both differences; the per-account rows do not.
      expect(september.totals).toEqual({ glBalance: 1170, subledgerBalance: 1170, difference: 0 });
      expect(await gl(org.orgId, kind, primary, '2026-09-30')).toBe(645);
      expect(await gl(org.orgId, kind, alternate, '2026-09-30')).toBe(525);
      expect(await agingNet(org.orgId, kind, '2026-09-30')).toBe(1170);
      // Month-end close lists both accounts without blocking on a policy finance has not set.
      const period = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: 'September 2026',
        startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30T23:59:59.999Z') } });
      const checklist = await (await closeChecklist(new NextRequest(`http://localhost/api/v1/accounting-periods/${period.id}/close-checklist`, { headers: headers(org.orgId) }),
        { params: Promise.resolve({ id: period.id }) })).json();
      expect(checklist.canClose).toBe(true);
      expect(checklist.items.find((i: { key: string }) => i.key === 'control_differences')).toMatchObject({ count: 2, blocking: false,
        accounts: expect.arrayContaining([expect.objectContaining({ accountId: primary, difference: 75 }), expect.objectContaining({ accountId: alternate, difference: -75 })]) });

      // Voided after the cutoff: still open in September, gone afterwards.
      await prisma.$transaction(tx => ar ? voidInvoice(tx, org.orgId, later, { date: date('2026-10-05') }) : voidBill(tx, org.orgId, later, { date: date('2026-10-05') }));
      expect(account(await reconcile(org.orgId, kind, '2026-09-30'), alternate)).toMatchObject({ glBalance: 525, subledgerBalance: 600 });
      const october = await reconcile(org.orgId, kind, '2026-10-05');
      expect(account(october, alternate)).toMatchObject({ glBalance: 225, subledgerBalance: 300, difference: -75 });
      expect(october.totals.subledgerBalance).toBe(await agingNet(org.orgId, kind, '2026-10-05'));
      expect(october.totals.subledgerBalance).toBe(870);
      // Before the first posting nothing exists on either control.
      expect((await reconcile(org.orgId, kind, '2026-09-09')).totals).toEqual({ glBalance: 0, subledgerBalance: 0, difference: 0 });
    } finally { await cleanupOrg(org.orgId); }
  });

  it(`${kind.toUpperCase()}: legacy refund postings, unreversed voids and control-coded document lines are named, never absorbed`, async () => {
    const org = await createTestOrg();
    const ar = kind === 'ar';
    try {
      const partyId = ar ? await createCustomer(org.orgId) : await createVendor(org.orgId);
      const control = org.accounts[ar ? 'arControl' : 'apControl'];
      const returns = (await prisma.account.create({ data: { organizationId: org.orgId, code: '5300', name: 'Returns', type: ar ? 'EXPENSE' : 'REVENUE', normalSide: ar ? 'DEBIT' : 'CREDIT' } })).id;
      const source = await document(org, kind, partyId, 'DOC-1', '2026-09-10', 1000);
      // A legacy refund that reduced the control instead of cash (#169).
      const refundJournal = await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: org.orgId, date: date('2026-09-12'), memo: `${ar ? 'Credit' : 'Debit'} note: REFUND-1`, lines: [
        { accountId: returns, description: `${ar ? 'Sales' : 'Purchase'} return - REFUND-1`, debit: ar ? 111 : 0, credit: ar ? 0 : 111 },
        { accountId: control, description: `${ar ? 'AR' : 'AP'} reduction - REFUND-1`, debit: ar ? 0 : 111, credit: ar ? 111 : 0 },
      ] }));
      const refund = { organizationId: org.orgId, number: 'REFUND-1', date: date('2026-09-12'), status: 'APPLIED' as const, amount: 111, taxAmount: 0, applyTax: false,
        settlementAccountId: org.accounts.bankAsset, returnAccountId: returns, journalEntryId: refundJournal.id };
      if (ar) await prisma.creditNote.create({ data: { ...refund, customerId: partyId, sourceInvoiceId: source, settlementType: 'REFUND' } });
      else await prisma.debitNote.create({ data: { ...refund, vendorId: partyId, sourceBillId: source, settlementType: 'REFUND_FROM_VENDOR' } });
      // A legacy void that changed status but never posted its reversal.
      const legacyVoid = await document(org, kind, partyId, 'DOC-LEGACY-VOID', '2026-09-14', 500);
      if (ar) await prisma.salesInvoice.update({ where: { id: legacyVoid }, data: { status: 'VOID' } });
      else await prisma.bill.update({ where: { id: legacyVoid }, data: { status: 'VOID' } });
      // A document offset coded to the control itself (#169): invoice charge or bill line.
      if (ar) await document(org, kind, partyId, 'DOC-CODED', '2026-09-16', 400, { chargeAccountId: control, chargeAmount: 50 });
      else await document(org, kind, partyId, 'DOC-CODED', '2026-09-16', 400, { lineAccountId: control });

      const result = await reconcile(org.orgId, kind, '2026-09-30');
      const row = account(result, control);
      const items = Object.fromEntries(row.items.map(i => [i.reference, i]));
      const prefix = ar ? 'Invoice' : 'Bill';
      expect(items[`${ar ? 'Credit note' : 'Debit note'} REFUND-1`]).toMatchObject({ category: 'DOCUMENT', amount: -111, message: expect.stringMatching(/refund but its posting moved/) });
      expect(items[`${prefix} DOC-LEGACY-VOID`]).toMatchObject({ category: 'DOCUMENT', amount: 500, message: expect.stringMatching(/void but its posting was never reversed/) });
      const coded = ar ? -50 : -400;
      expect(items[`${prefix} DOC-CODED`]).toMatchObject({ category: 'DOCUMENT', amount: coded, message: expect.stringMatching(/posting differs from the document amount/) });
      const subledger = ar ? 1000 + 450 : 1000 + 400;
      expect(row).toMatchObject({ subledgerBalance: subledger, glBalance: subledger - 111 + 500 + coded, difference: -111 + 500 + coded });
      expect(row.items).toHaveLength(3);
      expect(await gl(org.orgId, kind, control, '2026-09-30')).toBe(row.glBalance);
      expect(await agingNet(org.orgId, kind, '2026-09-30')).toBe(subledger);
    } finally { await cleanupOrg(org.orgId); }
  });
}

it('migration opening balances enter the AR/AP controls exactly once and stay reconciled through later settlement', async () => {
  const org = await createTestOrg();
  try {
    const batch = await createBatch(org.orgId, date('2026-01-01'), null);
    const codes = await resolveControlCodes(org.orgId);
    await stageEntity(org.orgId, batch.id, 'customers', [{ name: 'PT Opening Customer' }]);
    await stageEntity(org.orgId, batch.id, 'vendors', [{ name: 'CV Opening Vendor' }]);
    await stageEntity(org.orgId, batch.id, 'opening-journal', [
      { accountCode: codes.AR, debit: 1000, credit: 0 },
      { accountCode: codes.AP, debit: 0, credit: 600 },
      { accountCode: codes.OPENING_EQUITY, debit: 0, credit: 400 },
    ]);
    await stageEntity(org.orgId, batch.id, 'opening-invoices', [{ customerName: 'PT Opening Customer', invoiceNumber: 'OPEN-INV', issueDate: '2025-12-01', amount: 1000 }]);
    await stageEntity(org.orgId, batch.id, 'opening-bills', [{ vendorName: 'CV Opening Vendor', billNumber: 'OPEN-BILL', issueDate: '2025-12-05', amount: 600 }]);
    const committed = await commitBatch(org.orgId, batch.id, null);
    expect(committed).toMatchObject({ committed: true, reconcile: { ok: true } });

    const customerId = (await prisma.customer.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'PT Opening Customer' } })).id;
    const vendorId = (await prisma.vendor.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'CV Opening Vendor' } })).id;
    const openInvoice = (await prisma.salesInvoice.findFirstOrThrow({ where: { organizationId: org.orgId, number: 'OPEN-INV' } })).id;
    const openBill = (await prisma.bill.findFirstOrThrow({ where: { organizationId: org.orgId, number: 'OPEN-BILL' } })).id;

    for (const [kind, control, amount] of [['ar', org.accounts.arControl, 1000], ['ap', org.accounts.apControl, 600]] as const) {
      const cutover = await reconcile(org.orgId, kind, '2026-01-01');
      expect(account(cutover, control)).toMatchObject({ glBalance: amount, subledgerBalance: amount, difference: 0, opening: { subledger: amount, gl: amount }, items: [] });
    }

    const later = await document(org, 'ar', customerId, 'INV-FEB', '2026-02-01', 500);
    await payment(org, 'ar', customerId, 'RCPT-FEB', '2026-02-10', 1200, [{ documentId: openInvoice, applied: 1000 }, { documentId: later, applied: 200 }], null);
    const bill = await document(org, 'ap', vendorId, 'BILL-FEB', '2026-02-01', 300);
    await payment(org, 'ap', vendorId, 'PAY-FEB', '2026-02-10', 700, [{ documentId: openBill, applied: 600 }, { documentId: bill, applied: 100 }], null);

    for (const [kind, control, balance, opening] of [['ar', org.accounts.arControl, 300, 1000], ['ap', org.accounts.apControl, 200, 600]] as const) {
      const result = await reconcile(org.orgId, kind, '2026-02-28');
      expect(account(result, control)).toMatchObject({ glBalance: balance, subledgerBalance: balance, difference: 0, opening: { subledger: opening, gl: opening }, items: [] });
      expect(await gl(org.orgId, kind, control, '2026-02-28')).toBe(balance);
      expect(await agingNet(org.orgId, kind, '2026-02-28')).toBe(balance);
    }

    // A second opening seed for the same debt (e.g. a later customer/vendor import)
    // is not silently accepted: aging doubles it and reconciliation names it.
    await prisma.customer.update({ where: { id: customerId }, data: { openingBalance: 1000 } });
    await prisma.vendor.update({ where: { id: vendorId }, data: { openingBalance: 600 } });
    for (const [kind, control, balance, opening] of [['ar', org.accounts.arControl, 300, 1000], ['ap', org.accounts.apControl, 200, 600]] as const) {
      const row = account(await reconcile(org.orgId, kind, '2026-02-28'), control);
      expect(row).toMatchObject({ glBalance: balance, subledgerBalance: balance + opening, difference: -opening, opening: { subledger: opening * 2, gl: opening } });
      expect(row.items).toEqual([expect.objectContaining({ category: 'OPENING', amount: -opening })]);
      expect(await agingNet(org.orgId, kind, '2026-02-28')).toBe(balance + opening);
    }
  } finally { await cleanupOrg(org.orgId); }
});

it('rejects an unknown control kind', async () => {
  const response = await reconciliationReport(new NextRequest('http://localhost/api/v1/reports/control-reconciliation?kind=gl&asOfDate=2026-09-30', { headers: headers('org-unused') }));
  expect(response.status).toBe(400);
});
