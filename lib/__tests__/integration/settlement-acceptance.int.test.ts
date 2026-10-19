/**
 * ACC-02 settlement acceptance: AR receipts and AP payments driven through the
 * real API routes (create / void) and the real approval routes + engine, with
 * fixed values asserted on every surface a user or auditor reads:
 *
 *   - document settlement status (invoice/bill status + its settlement route),
 *   - AR/AP aging (reports route, type=aging) at dated snapshots,
 *   - the discount and penalty GL accounts,
 *   - the AR/AP control account GL.
 *
 * Posting-helper coverage of the same arithmetic lives in
 * report-reconciliation.int.test.ts (notes, refunds, helper-dated voids) and
 * payment-settlement-status.int.test.ts (status transitions); this file only
 * adds what those cannot reach: the request path, the approval hold/approve/
 * reject/rollback path, multi-document allocation, cent rounding and a void
 * dated by the route's own clock after the cutoff.
 *
 * Convention (lib/payment-validation.ts): an allocation clears
 * amountApplied + discountAmount of the document; the cash received/paid is
 * amountApplied + penaltyAmount. So cash + discount - penalty = debt cleared.
 *
 * Run with:  npm run test:int -- settlement-acceptance
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect, assertTrialBalanced, type TestOrg } from './harness';
import { postInvoiceSend } from '../../invoice-send-posting';
import { postBillToLedger } from '../../bill-posting';
import { POST as createArPayment } from '@/src/app/api/v1/ar-payments/route';
import { POST as createApPayment } from '@/src/app/api/v1/ap-payments/route';
import { POST as voidArPaymentRoute } from '@/src/app/api/v1/ar-payments/[id]/void/route';
import { POST as voidApPaymentRoute } from '@/src/app/api/v1/ap-payments/[id]/void/route';
import { POST as approveRoute } from '@/src/app/api/v1/approvals/[id]/approve/route';
import { POST as rejectRoute } from '@/src/app/api/v1/approvals/[id]/reject/route';
import { GET as arReport } from '@/src/app/api/v1/reports/ar/route';
import { GET as apReport } from '@/src/app/api/v1/reports/ap/route';
import { GET as invoiceSettlement } from '@/src/app/api/v1/invoices/[id]/settlement/route';
import { GET as billSettlement } from '@/src/app/api/v1/bills/[id]/settlement/route';

afterAll(disconnect);
afterEach(() => { vi.useRealTimers(); });

type Kind = 'ar' | 'ap';
const day = (d: string) => new Date(`${d}T00:00:00Z`);

interface Fixture {
  org: TestOrg;
  kind: Kind;
  partyId: string;
  submitter: string;
  approver: string;
  control: string;
  bank: string;
  discount: string;
  penalty: string;
}

async function seedAdmin(orgId: string): Promise<string> {
  const role = await prisma.role.create({ data: { organizationId: orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' }, select: { id: true } });
  const user = await prisma.user.create({
    data: { email: `u-${randomUUID()}@test.local`, fullName: 'Settlement QA', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } });
  return user.id;
}

async function setup(kind: Kind, opts: { approval?: boolean } = {}): Promise<Fixture> {
  const org = await createTestOrg();
  const ar = kind === 'ar';
  const account = async (code: string, name: string, type: 'EXPENSE' | 'REVENUE') =>
    (await prisma.account.create({ data: { organizationId: org.orgId, code, name, type, normalSide: type === 'EXPENSE' ? 'DEBIT' : 'CREDIT' }, select: { id: true } })).id;
  // AR: discount is an expense, the late fee is revenue. AP mirrors it.
  const discount = await account('5350', 'Settlement discount', ar ? 'EXPENSE' : 'REVENUE');
  const penalty = await account('5400', 'Late fee', ar ? 'REVENUE' : 'EXPENSE');
  if (opts.approval) {
    await prisma.organization.update({ where: { id: org.orgId }, data: { approvalRequirements: { [ar ? 'ar_payments' : 'ap_payments']: true } } });
  }
  return {
    org,
    kind,
    partyId: ar ? await createCustomer(org.orgId) : await createVendor(org.orgId),
    submitter: await seedAdmin(org.orgId),
    approver: await seedAdmin(org.orgId),
    control: org.accounts[ar ? 'arControl' : 'apControl'],
    bank: org.accounts.bankAsset,
    discount,
    penalty,
  };
}

/** A posted invoice (AR) or bill (AP), no tax, so the control carries exactly `total`. */
async function postDocument(f: Fixture, number: string, total: number, issue = '2026-09-01', due = '2026-09-30'): Promise<string> {
  const { orgId } = f.org;
  if (f.kind === 'ar') {
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: orgId, customerId: f.partyId, number, issueDate: day(issue), dueDate: day(due),
      status: 'SENT', taxEnabled: false, subtotal: total, taxAmount: 0, totalAmount: total,
      lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: total }] } }, select: { id: true } });
    await prisma.$transaction(tx => postInvoiceSend(tx, orgId, invoice.id));
    return invoice.id;
  }
  const bill = await prisma.bill.create({ data: { organizationId: orgId, vendorId: f.partyId, number, issueDate: day(issue), dueDate: day(due),
    status: 'OPEN', taxable: false, subtotal: total, taxAmount: 0, totalAmount: total,
    lines: { create: [{ lineNo: 1, accountId: f.org.accounts.cogsExpense, description: 'Service', quantity: 1, price: total, lineTotal: total }] } },
  include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, orgId, bill));
  return bill.id;
}

function request(f: Fixture, userId: string, path: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'x-org-id': f.org.orgId, 'x-user-id': userId, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

interface Allocation { documentId: string; amountApplied: number; discountAmount?: number; penaltyAmount?: number }

/** POST the payment form payload exactly as the AR receipt / AP payment screens send it. */
async function submitPayment(f: Fixture, date: string, totalAmount: number, allocations: Allocation[]) {
  const ar = f.kind === 'ar';
  const body = {
    [ar ? 'customerId' : 'vendorId']: f.partyId,
    date,
    method: 'BANK_TRANSFER',
    status: 'COMPLETED',
    totalAmount,
    [ar ? 'depositAccountId' : 'cashAccountId']: f.bank,
    [ar ? 'arAccountId' : 'apAccountId']: f.control,
    discountAccountId: f.discount,
    penaltyAccountId: f.penalty,
    allocations: allocations.map(({ documentId, ...a }) => ({ [ar ? 'invoiceId' : 'billId']: documentId, ...a })),
  };
  const res = await (ar ? createArPayment : createApPayment)(request(f, f.submitter, `/api/v1/${ar ? 'ar' : 'ap'}-payments`, 'POST', body));
  return { status: res.status, body: await res.json() as { id: string; number: string; status: string; error?: string } };
}

async function pendingRequestId(f: Fixture, paymentId: string): Promise<string> {
  const row = await prisma.approvalRequest.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: paymentId, status: 'PENDING' }, select: { id: true } });
  return row.id;
}
async function approve(f: Fixture, paymentId: string) {
  const id = await pendingRequestId(f, paymentId);
  return approveRoute(request(f, f.approver, `/api/v1/approvals/${id}/approve`, 'POST', {}), ctx(id));
}
async function reject(f: Fixture, paymentId: string, note: string) {
  const id = await pendingRequestId(f, paymentId);
  return rejectRoute(request(f, f.approver, `/api/v1/approvals/${id}/reject`, 'POST', { note }), ctx(id));
}
async function voidPayment(f: Fixture, paymentId: string) {
  const ar = f.kind === 'ar';
  return (ar ? voidArPaymentRoute : voidApPaymentRoute)(request(f, f.submitter, `/api/v1/${ar ? 'ar' : 'ap'}-payments/${paymentId}/void`, 'POST'), ctx(paymentId));
}

async function payment(f: Fixture, id: string) {
  const where = { id };
  const select = { status: true, journalEntryId: true } as const;
  return f.kind === 'ar' ? prisma.aRPayment.findUniqueOrThrow({ where, select }) : prisma.aPPayment.findUniqueOrThrow({ where, select });
}
async function documentStatus(f: Fixture, id: string): Promise<string> {
  return f.kind === 'ar'
    ? (await prisma.salesInvoice.findUniqueOrThrow({ where: { id }, select: { status: true } })).status
    : (await prisma.bill.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}
async function settlement(f: Fixture, id: string) {
  const res = await (f.kind === 'ar' ? invoiceSettlement : billSettlement)(request(f, f.submitter, `/api/v1/${f.kind === 'ar' ? 'invoices' : 'bills'}/${id}/settlement`), ctx(id));
  expect(res.status).toBe(200);
  const body = await res.json() as { paid: number; owing: number; state: string };
  return { paid: body.paid, owing: body.owing, state: body.state };
}

/** Aging total plus the per-document balances the aging rows show. */
async function aging(f: Fixture, asOf: string) {
  const res = await (f.kind === 'ar' ? arReport : apReport)(request(f, f.submitter, `/api/v1/reports/${f.kind}?type=aging&asOfDate=${asOf}`));
  expect(res.status).toBe(200);
  const body = await res.json() as { rows: Array<Record<string, unknown>>; summary: { totalOutstanding: number; netOutstanding: number }; warnings: string[] };
  expect(body.warnings).toEqual([]);
  const balances = Object.fromEntries(body.rows.map(r => [String(r[f.kind === 'ar' ? 'invoiceNumber' : 'billNumber']), r.balance as number]));
  return { total: body.summary.totalOutstanding, net: body.summary.netOutstanding, balances };
}

/** Signed GL balance at the end of a Jakarta business day (debit-positive unless told otherwise). */
async function gl(f: Fixture, accountId: string, asOf: string, debitPositive: boolean): Promise<number> {
  const sum = await prisma.journalLine.aggregate({
    where: { accountId, entry: { organizationId: f.org.orgId, status: 'POSTED', date: { lte: new Date(`${asOf}T16:59:59.999Z`) } } },
    _sum: { debit: true, credit: true },
  });
  const net = Math.round((Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0)) * 100) / 100;
  return (debitPositive ? net : -net) || 0;
}
/**
 * Control (debt owed), discount and penalty (amount booked) and cash (received
 * for AR, paid out for AP), each positive in its natural direction.
 */
async function ledger(f: Fixture, asOf: string) {
  const ar = f.kind === 'ar';
  return {
    control: await gl(f, f.control, asOf, ar),
    discount: await gl(f, f.discount, asOf, ar),
    penalty: await gl(f, f.penalty, asOf, !ar),
    cash: await gl(f, f.bank, asOf, ar),
  };
}

for (const kind of ['ar', 'ap'] as const) {
  const label = kind === 'ar' ? 'AR receipt' : 'AP payment';
  const settledStatus = 'PAID';
  const openStatus = kind === 'ar' ? 'SENT' : 'OPEN';

  describe(`${kind.toUpperCase()} settlement acceptance through routes and approval`, () => {
    it(`${label}: partial then full settlement with cash + discount - penalty, each held for and cleared by approval; a route void after the cutoff reopens only later snapshots`, async () => {
      const f = await setup(kind, { approval: true });
      try {
        const doc = await postDocument(f, 'DOC-1', 1_000_000);

        // Partial: 400,000 cash, no adjustments. Held: no GL, no settlement.
        const first = await submitPayment(f, '2026-09-10', 400_000, [{ documentId: doc, amountApplied: 400_000 }]);
        expect(first.status).toBe(201);
        expect(first.body.status).toBe('PENDING_APPROVAL');
        expect(await payment(f, first.body.id)).toEqual({ status: 'PENDING_APPROVAL', journalEntryId: null });
        expect((await aging(f, '2026-09-30')).total).toBe(1_000_000);
        expect(await ledger(f, '2026-09-30')).toEqual({ control: 1_000_000, discount: 0, penalty: 0, cash: 0 });

        expect((await approve(f, first.body.id)).status).toBe(200);
        expect((await payment(f, first.body.id)).status).toBe('COMPLETED');
        expect(await documentStatus(f, doc)).toBe(openStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 400_000, owing: 600_000, state: 'PARTIAL' });
        expect((await aging(f, '2026-09-15')).balances).toEqual({ 'DOC-1': 600_000 });

        // Full: cash 590,500 = 588,000 principal + 2,500 late fee; 12,000 discount.
        // Cleared = 588,000 + 12,000 = 600,000 = 590,500 + 12,000 - 2,500.
        const second = await submitPayment(f, '2026-09-20', 590_500, [{ documentId: doc, amountApplied: 588_000, discountAmount: 12_000, penaltyAmount: 2_500 }]);
        expect(second.status).toBe(201);
        expect(second.body.status).toBe('PENDING_APPROVAL');
        expect(await documentStatus(f, doc)).toBe(openStatus);
        expect((await aging(f, '2026-09-30')).total).toBe(600_000);

        expect((await approve(f, second.body.id)).status).toBe(200);
        expect(await documentStatus(f, doc)).toBe(settledStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 1_000_000, owing: 0, state: 'PAID' });
        expect((await aging(f, '2026-09-15')).total).toBe(600_000);
        expect((await aging(f, '2026-09-30')).total).toBe(0);
        expect(await ledger(f, '2026-09-15')).toEqual({ control: 600_000, discount: 0, penalty: 0, cash: 400_000 });
        expect(await ledger(f, '2026-09-30')).toEqual({ control: 0, discount: 12_000, penalty: 2_500, cash: 990_500 });

        // The void route dates its reversal "now": 2026-10-05 10:00 Jakarta.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-05T03:00:00Z'));
        const voided = await voidPayment(f, second.body.id);
        vi.useRealTimers();
        expect(voided.status).toBe(200);
        expect((await payment(f, second.body.id)).status).toBe('VOID');
        expect(await documentStatus(f, doc)).toBe(openStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 400_000, owing: 600_000, state: 'PARTIAL' });

        // September is unchanged; the void reopens the debt from 5 October.
        expect((await aging(f, '2026-09-30')).total).toBe(0);
        expect(await ledger(f, '2026-09-30')).toEqual({ control: 0, discount: 12_000, penalty: 2_500, cash: 990_500 });
        expect((await aging(f, '2026-10-04')).total).toBe(0);
        expect((await aging(f, '2026-10-05')).balances).toEqual({ 'DOC-1': 600_000 });
        expect(await ledger(f, '2026-10-05')).toEqual({ control: 600_000, discount: 0, penalty: 0, cash: 400_000 });
        await assertTrialBalanced(f.org.orgId, label);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    it(`${label}: rejection and a failed approval both leave GL, aging and settlement exactly as before`, async () => {
      const f = await setup(kind, { approval: true });
      try {
        const doc = await postDocument(f, 'DOC-1', 500_000);
        const held = await submitPayment(f, '2026-09-12', 101_000, [{ documentId: doc, amountApplied: 100_000, discountAmount: 5_000, penaltyAmount: 1_000 }]);
        expect(held.body.status).toBe('PENDING_APPROVAL');
        const entriesBefore = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });

        const rejected = await reject(f, held.body.id, 'Wrong discount');
        expect(rejected.status).toBe(200);
        expect(await payment(f, held.body.id)).toEqual({ status: 'DRAFT', journalEntryId: null });
        expect(await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: held.body.id }, select: { status: true, note: true } }))
          .toEqual({ status: 'REJECTED', note: 'Wrong discount' });
        expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(entriesBefore);
        expect(await documentStatus(f, doc)).toBe(openStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 0, owing: 500_000, state: 'OUTSTANDING' });
        expect((await aging(f, '2026-09-30')).total).toBe(500_000);
        expect(await ledger(f, '2026-09-30')).toEqual({ control: 500_000, discount: 0, penalty: 0, cash: 0 });

        // A second receipt for 300,000 is held, then the document is settled in
        // full by another approved payment; approving the stale one must fail
        // and roll back the claim, the posting and the settlement together.
        const stale = await submitPayment(f, '2026-09-14', 300_000, [{ documentId: doc, amountApplied: 300_000 }]);
        const full = await submitPayment(f, '2026-09-15', 495_000, [{ documentId: doc, amountApplied: 490_000, discountAmount: 10_000, penaltyAmount: 5_000 }]);
        expect((await approve(f, full.body.id)).status).toBe(200);
        expect(await documentStatus(f, doc)).toBe(settledStatus);
        const settledLedger = await ledger(f, '2026-09-30');
        expect(settledLedger).toEqual({ control: 0, discount: 10_000, penalty: 5_000, cash: 495_000 });
        const entriesSettled = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });

        const failed = await approve(f, stale.body.id);
        expect(failed.status).toBe(422);
        expect((await failed.json()).error).toMatch(/over-allocation/i);
        expect(await payment(f, stale.body.id)).toEqual({ status: 'PENDING_APPROVAL', journalEntryId: null });
        expect((await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: stale.body.id }, select: { status: true } })).status).toBe('PENDING');
        expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(entriesSettled);
        expect(await documentStatus(f, doc)).toBe(settledStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 500_000, owing: 0, state: 'PAID' });
        expect((await aging(f, '2026-09-30')).total).toBe(0);
        expect(await ledger(f, '2026-09-30')).toEqual(settledLedger);

        // The stale request can then be rejected cleanly.
        expect((await reject(f, stale.body.id, 'Already settled')).status).toBe(200);
        expect(await payment(f, stale.body.id)).toEqual({ status: 'DRAFT', journalEntryId: null });
        expect(await ledger(f, '2026-09-30')).toEqual(settledLedger);
        await assertTrialBalanced(f.org.orgId, label);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    it(`${label}: one payment allocated across three documents with cent amounts settles each exactly`, async () => {
      const f = await setup(kind);
      try {
        const a = await postDocument(f, 'DOC-A', 100.10, '2026-08-01', '2026-08-31');
        const b = await postDocument(f, 'DOC-B', 200.20, '2026-08-15', '2026-09-14');
        const c = await postDocument(f, 'DOC-C', 300.30, '2026-09-01', '2026-10-01');

        // Cash 450.41 = 100.00 + 200.19 + 0.07 fee + 150.15; discounts 0.10 + 0.01.
        // Cleared: A 100.10 (full), B 200.20 (full), C 150.15 (half) = 450.45.
        const paid = await submitPayment(f, '2026-09-20', 450.41, [
          { documentId: a, amountApplied: 100.00, discountAmount: 0.10 },
          { documentId: b, amountApplied: 200.19, discountAmount: 0.01, penaltyAmount: 0.07 },
          { documentId: c, amountApplied: 150.15 },
        ]);
        expect(paid.status).toBe(201);
        expect(paid.body.status).toBe('COMPLETED');

        expect([await documentStatus(f, a), await documentStatus(f, b), await documentStatus(f, c)]).toEqual([settledStatus, settledStatus, openStatus]);
        expect(await settlement(f, a)).toEqual({ paid: 100.10, owing: 0, state: 'PAID' });
        expect(await settlement(f, b)).toEqual({ paid: 200.20, owing: 0, state: 'PAID' });
        expect(await settlement(f, c)).toEqual({ paid: 150.15, owing: 150.15, state: 'PARTIAL' });
        expect(await aging(f, '2026-09-19')).toEqual({ total: 600.60, net: 600.60, balances: { 'DOC-A': 100.10, 'DOC-B': 200.20, 'DOC-C': 300.30 } });
        expect(await aging(f, '2026-09-20')).toEqual({ total: 150.15, net: 150.15, balances: { 'DOC-C': 150.15 } });
        expect(await ledger(f, '2026-09-20')).toEqual({ control: 150.15, discount: 0.11, penalty: 0.07, cash: 450.41 });

        const lines = await prisma.journalLine.findMany({
          where: { entry: { organizationId: f.org.orgId, memo: `${kind === 'ar' ? 'AR receipt' : 'AP payment'}: ${paid.body.number}` } },
          select: { accountId: true, debit: true, credit: true },
        });
        const side = (id: string) => lines.filter(l => l.accountId === id).map(l => [Number(l.debit), Number(l.credit)]);
        expect(side(f.control)).toEqual([kind === 'ar' ? [0, 450.45] : [450.45, 0]]);
        expect(side(f.bank)).toEqual([kind === 'ar' ? [450.41, 0] : [0, 450.41]]);
        expect(side(f.discount)).toEqual([kind === 'ar' ? [0.11, 0] : [0, 0.11]]);
        expect(side(f.penalty)).toEqual([kind === 'ar' ? [0, 0.07] : [0.07, 0]]);
        await assertTrialBalanced(f.org.orgId, label);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    it(`${label}: sub-cent and one-cent-short amounts never mark a document settled that aging and GL still show as owed`, async () => {
      const f = await setup(kind, { approval: true });
      try {
        const doc = await postDocument(f, 'DOC-1', 150.10);
        // The form may send an unrounded number. PostgreSQL stores 150.105 as
        // 150.11, so the submission guard must round it the same way
        // (150.105 * 100 is 15010.4999… in floating point) and refuse it now,
        // not hold it for an approval that can only fail.
        const subCent = await submitPayment(f, '2026-09-20', 150.105, [{ documentId: doc, amountApplied: 150.105 }]);
        expect(subCent.status).toBe(422);
        expect(subCent.body.error).toMatch(/over-allocation: remaining balance is 150\.10/i);
        const where = { organizationId: f.org.orgId };
        expect(kind === 'ar' ? await prisma.aRPayment.count({ where }) : await prisma.aPPayment.count({ where })).toBe(0);
        expect(await prisma.approvalRequest.count({ where: { organizationId: f.org.orgId } })).toBe(0);

        // One cent short stays open on every surface, then the last cent settles it.
        const short = await submitPayment(f, '2026-09-20', 150.09, [{ documentId: doc, amountApplied: 150.09 }]);
        expect(short.status).toBe(201);
        expect((await approve(f, short.body.id)).status).toBe(200);
        expect(await documentStatus(f, doc)).toBe(openStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 150.09, owing: 0.01, state: 'PARTIAL' });
        expect((await aging(f, '2026-09-20')).balances).toEqual({ 'DOC-1': 0.01 });
        expect((await ledger(f, '2026-09-20')).control).toBe(0.01);

        const last = await submitPayment(f, '2026-09-21', 0.01, [{ documentId: doc, amountApplied: 0.01 }]);
        expect(last.status).toBe(201);
        expect((await approve(f, last.body.id)).status).toBe(200);
        expect(await documentStatus(f, doc)).toBe(settledStatus);
        expect(await settlement(f, doc)).toEqual({ paid: 150.10, owing: 0, state: 'PAID' });
        expect((await aging(f, '2026-09-21')).total).toBe(0);
        expect((await ledger(f, '2026-09-21')).control).toBe(0);
        await assertTrialBalanced(f.org.orgId, label);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  });
}
