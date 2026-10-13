import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Prisma, ApprovalDocumentType } from '@prisma/client';
import { NextRequest } from 'next/server';
import { POST as createJournal } from '@/src/app/api/v1/journal-entries/route';
import { PUT as editJournal } from '@/src/app/api/v1/journal-entries/[id]/route';
import { POST as createBankTransaction } from '@/src/app/api/v1/bank-transactions/route';
import { PUT as editBankTransaction } from '@/src/app/api/v1/bank-transactions/[id]/route';
import { POST as importOpening } from '@/src/app/api/v1/import/[entity]/route';
import { POST as closePeriod } from '@/src/app/api/v1/accounting-periods/[id]/close/route';
import { GET as closeChecklist } from '@/src/app/api/v1/accounting-periods/[id]/close-checklist/route';
import { PUT as applyCredit } from '@/src/app/api/v1/credit-notes/[id]/route';
import { closeAccountingPeriod } from '@/lib/period-close';
import { approveRequest, rejectRequest, routeForApproval } from '@/lib/approval/engine';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect, accountBalance,
  journalEntryCount, assertTrialBalanced } from './harness';

afterAll(disconnect);
const DAY = '2026-09-15', DATE = new Date(DAY);
type Tx = Prisma.TransactionClient;
async function fixture() {
  const org = await createTestOrg();
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Finance', passwordHash: 'x', status: 'ACTIVE' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
  const customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
  const period = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: 'September 2026',
    startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30T23:59:59.999Z') } });
  return { org, customerId, vendorId, period, actor: { orgId: org.orgId, userId: user.id, roleType: 'ADMIN' } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(f: Fixture, method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/v1/test', { method, headers: { 'x-org-id': f.org.orgId,
    'x-user-id': f.actor.userId, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function journal(f: Fixture, accountId: string, source = 'MANUAL') {
  return { date: DAY, source, status: 'POSTED', memo: 'Direct posting', lines: [
    { accountId, description: 'Debit', debit: 100, credit: 0 },
    { accountId: f.org.accounts.bankAsset, description: 'Credit', debit: 0, credit: 100 },
  ] };
}
function close(f: Fixture) { return closePeriod(request(f, 'POST'), { params: Promise.resolve({ id: f.period.id }) }); }
function checklist(f: Fixture) { return closeChecklist(request(f, 'GET'), { params: Promise.resolve({ id: f.period.id }) }); }
async function note(f: Fixture, status: 'DRAFT' | 'PENDING_APPROVAL' = 'DRAFT', date = DATE) {
  return prisma.creditNote.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, number: `CN-${randomUUID()}`,
    date, amount: 100, status, returnAccountId: f.org.accounts.cogsExpense } });
}
async function financial(f: Fixture, kind: ApprovalDocumentType) {
  const base = { organizationId: f.org.orgId, number: `DOC-${kind}`, status: 'PENDING_APPROVAL' as const };
  const invoice = () => prisma.salesInvoice.create({ data: { organizationId: f.org.orgId, customerId: f.customerId,
    number: `SOURCE-${randomUUID()}`, issueDate: DATE, status: 'SENT' } });
  const bill = () => prisma.bill.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId,
    number: `SOURCE-${randomUUID()}`, issueDate: DATE, status: 'OPEN' } });
  switch (kind) {
    case 'INVOICE': return prisma.salesInvoice.create({ data: { ...base, customerId: f.customerId, issueDate: DATE,
      subtotal: 100, totalAmount: 100, lines: { create: { lineNo: 1, description: 'Service', quantity: 1, price: 100, lineSubtotal: 100 } } } });
    case 'BILL': return prisma.bill.create({ data: { ...base, vendorId: f.vendorId, issueDate: DATE } });
    case 'CREDIT_NOTE': return note(f, 'PENDING_APPROVAL');
    case 'DEBIT_NOTE': return prisma.debitNote.create({ data: { ...base, vendorId: f.vendorId, date: DATE, amount: 100 } });
    case 'AR_PAYMENT': return prisma.aRPayment.create({ data: { ...base, customerId: f.customerId, date: DATE, totalAmount: 100 } });
    case 'AP_PAYMENT': return prisma.aPPayment.create({ data: { ...base, vendorId: f.vendorId, date: DATE, totalAmount: 100 } });
    case 'SALES_RETURN': return prisma.salesReturn.create({ data: { ...base, customerId: f.customerId, invoiceId: (await invoice()).id, returnDate: DATE } });
    case 'PURCHASE_RETURN': return prisma.purchaseReturn.create({ data: { ...base, vendorId: f.vendorId, billId: (await bill()).id, returnDate: DATE } });
    case 'STOCK_ADJUSTMENT': return prisma.stockAdjustment.create({ data: { ...base, date: DATE, reason: 'Count variance' } });
    case 'PAYROLL_RUN': return prisma.payrollRun.create({ data: { ...base, month: 9, year: 2026, periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') } });
    default: throw new Error('Not financial');
  }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function overlap(first: (tx: Tx) => Promise<unknown>, second: () => Promise<unknown>) {
  const ready = deferred<number>(), release = deferred<void>();
  const a = prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await first(tx); ready.resolve(rows[0].pid); await release.promise;
  }, { timeout: 15000 });
  const settledA = a.then(() => undefined, error => error);
  let settledB: Promise<unknown> | undefined;
  try {
    const pid = await Promise.race([ready.promise, a.then(() => { throw new Error('Winner did not reach barrier'); })]);
    settledB = second().then(value => value, error => error);
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (rows[0].blocked) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    expect(blocked, 'must observe a real PostgreSQL wait').toBe(true);
  } finally { release.resolve(); await settledA; if (settledB) await settledB; }
  if (await settledA) throw await settledA;
  return settledB!;
}

describe('ordinary postings cannot bypass AR/AP controls', () => {
  for (const role of ['arControl', 'apControl'] as const) {
    for (const source of ['MANUAL', 'OPENING', 'SYSTEM']) {
      it(`${role}: manual POST refuses control even with source=${source}`, async () => {
        const f = await fixture();
        try {
          const response = await createJournal(request(f, 'POST', journal(f, f.org.accounts[role], source)));
          expect(response.status).toBe(422);
          expect(await journalEntryCount(f.org.orgId)).toBe(0);
          expect(await accountBalance(f.org.orgId, f.org.accounts[role])).toBe(0);
        } finally { await cleanupOrg(f.org.orgId); }
      });
    }
    it(`${role}: PUT cannot finalize a legacy control-account draft`, async () => {
      const f = await fixture();
      try {
        const payload = journal(f, f.org.accounts[role]);
        const entry = await prisma.journalEntry.create({ data: { organizationId: f.org.orgId, entryNo: 'LEGACY-DRAFT',
          date: DATE, memo: 'Legacy control draft', status: 'DRAFT', totalDebit: 100, totalCredit: 100,
          lines: { create: payload.lines.map((line, i) => ({ ...line, lineNo: i + 1 })) } } });
        const response = await editJournal(request(f, 'PUT', payload), { params: Promise.resolve({ id: entry.id }) });
        expect(response.status).toBe(422);
        expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('DRAFT');
        expect(await journalEntryCount(f.org.orgId)).toBe(1);
        expect(await accountBalance(f.org.orgId, f.org.accounts[role])).toBe(0);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${role}: manual and bank categorisation refuse an additional document control account`, async () => {
      const f = await fixture();
      try {
        const extra = await prisma.account.create({ data: { organizationId: f.org.orgId, code: '9998', name: 'Alternate control',
          type: role === 'arControl' ? 'ASSET' : 'LIABILITY', normalSide: role === 'arControl' ? 'DEBIT' : 'CREDIT' } });
        if (role === 'arControl') await prisma.creditNote.create({ data: { organizationId: f.org.orgId, customerId: f.customerId,
          number: 'CN-OVERRIDE', date: DATE, amount: 100, arAccountId: extra.id } });
        else await prisma.bill.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId, number: 'B-OVERRIDE', issueDate: DATE, apAccountId: extra.id } });
        expect((await createJournal(request(f, 'POST', journal(f, extra.id)))).status).toBe(422);
        const bank = await prisma.bankAccount.create({ data: { organizationId: f.org.orgId, code: '1110', name: 'Cash & Bank', currentBalance: 0 } });
        const response = await createBankTransaction(request(f, 'POST', { bankAccountId: bank.id, date: DAY, type: 'INCOME',
          amount: 100, incomeAccountId: extra.id, description: 'Bypass attempt' }));
        expect(response.status).toBe(422);
        expect(await prisma.bankTransaction.count({ where: { organizationId: f.org.orgId } })).toBe(0);
        expect(Number((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance)).toBe(0);
        expect(await journalEntryCount(f.org.orgId)).toBe(0);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }
  it('bank edit refusal rolls back its earlier reversal and balance changes', async () => {
    const f = await fixture();
    try {
      const bank = await prisma.bankAccount.create({ data: { organizationId: f.org.orgId, code: '1110', name: 'Cash & Bank', currentBalance: 0 } });
      const response = await createBankTransaction(request(f, 'POST', { bankAccountId: bank.id, date: DAY, type: 'INCOME',
        amount: 100, incomeAccountId: f.org.accounts.salesRevenue, description: 'Ordinary income' }));
      expect(response.status).toBe(201);
      const row = await prisma.bankTransaction.findFirstOrThrow({ where: { organizationId: f.org.orgId } });
      const edit = await editBankTransaction(request(f, 'PUT', { incomeAccountId: f.org.accounts.arControl }), { params: Promise.resolve({ id: row.id }) });
      expect(edit.status).toBe(422);
      expect(await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
      expect(await journalEntryCount(f.org.orgId)).toBe(1);
      expect(await accountBalance(f.org.orgId, f.org.accounts.bankAsset)).toBe(100);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(0);
      expect(Number((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance)).toBe(100);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('ordinary expense journal and controlled opening import remain available', async () => {
    const f = await fixture();
    try {
      expect((await createJournal(request(f, 'POST', journal(f, f.org.accounts.cogsExpense)))).status).toBe(201);
      const response = await importOpening(request(f, 'POST', { rows: [
        { accountCode: '1210', debit: 500 }, { accountCode: '2100', credit: 300 }, { accountCode: '3900', credit: 200 },
      ] }), { params: Promise.resolve({ entity: 'opening-journal' }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: 1 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(500);
      expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-300);
      expect(await journalEntryCount(f.org.orgId)).toBe(2);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });
});

describe('pending financial documents block their posting period close', () => {
  for (const kind of ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'AR_PAYMENT', 'AP_PAYMENT',
    'SALES_RETURN', 'PURCHASE_RETURN', 'STOCK_ADJUSTMENT', 'PAYROLL_RUN'] as const) {
    it(`${kind}: checklist and close refuse; rejection through engine releases the block`, async () => {
      const f = await fixture();
      try {
        const doc = await financial(f, kind);
        // No request yet: orphaned pending documents must still block closure.
        const body = await (await checklist(f)).json();
        expect(body.canClose).toBe(false);
        expect(body.items.find((item: { key: string }) => item.key === 'pending_approvals')).toMatchObject({ count: 1, blocking: true });
        expect((await close(f)).status).toBe(422);
        expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: f.period.id } })).status).toBe('OPEN');
        const req = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId, documentType: kind,
          documentId: doc.id, requestedById: f.actor.userId, requestedAt: new Date('2026-10-05') } });
        await rejectRequest(req.id, f.actor, 'Revise before next period');
        expect((await close(f)).status).toBe(200);
        expect(await journalEntryCount(f.org.orgId)).toBe(0);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }
  it('approval of an in-period invoice removes the block and preserves its posted AR', async () => {
    const f = await fixture();
    try {
      const doc = await financial(f, 'INVOICE');
      const req = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId,
        documentType: 'INVOICE', documentId: doc.id, requestedById: f.actor.userId } });
      await approveRequest(req.id, f.actor);
      expect((await close(f)).status).toBe(200);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(100);
      expect(await journalEntryCount(f.org.orgId)).toBe(1);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('other periods/companies and non-financial orders do not block this period', async () => {
    const f = await fixture(), other = await fixture();
    try {
      await note(f, 'PENDING_APPROVAL', new Date('2026-10-01'));
      await note(other, 'PENDING_APPROVAL');
      const po = await prisma.purchaseOrder.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId,
        number: 'PO-PENDING', date: DATE, status: 'PENDING_APPROVAL' } });
      await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId, documentType: 'PURCHASE_ORDER', documentId: po.id, requestedById: f.actor.userId } });
      expect((await (await checklist(f)).json()).canClose).toBe(true);
      expect((await close(f)).status).toBe(200);
    } finally { await cleanupOrg(f.org.orgId); await cleanupOrg(other.org.orgId); }
  });
  it('submission wins: close waits, then refuses the newly committed hold', async () => {
    const f = await fixture();
    try {
      const cn = await note(f);
      await prisma.organization.update({ where: { id: f.org.orgId }, data: { approvalRequirements: { ar_credits: true } } });
      const response = await overlap(async tx => {
        expect(await routeForApproval(tx, { orgId: f.org.orgId, userId: f.actor.userId, documentType: 'CREDIT_NOTE', documentId: cn.id })).toBe(true);
        await tx.creditNote.update({ where: { id: cn.id }, data: { status: 'PENDING_APPROVAL' } });
      }, () => close(f)) as Response;
      expect(response.status).toBe(422);
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: f.period.id } })).status).toBe('OPEN');
      expect((await prisma.creditNote.findUniqueOrThrow({ where: { id: cn.id } })).status).toBe('PENDING_APPROVAL');
      expect(await journalEntryCount(f.org.orgId)).toBe(0);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('close wins: actual note submission waits, then refuses without creating an approval or journal', async () => {
    const f = await fixture();
    try {
      const cn = await note(f);
      await prisma.organization.update({ where: { id: f.org.orgId }, data: { approvalRequirements: { ar_credits: true } } });
      const response = await overlap(tx => closeAccountingPeriod(tx, f.org.orgId, f.actor.userId, f.period.id),
        () => applyCredit(request(f, 'PUT', { status: 'APPLIED' }), { params: Promise.resolve({ id: cn.id }) })) as Response;
      expect(response.status).toBe(422);
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: f.period.id } })).status).toBe('CLOSED');
      expect((await prisma.creditNote.findUniqueOrThrow({ where: { id: cn.id } })).status).toBe('DRAFT');
      expect(await prisma.approvalRequest.count({ where: { organizationId: f.org.orgId } })).toBe(0);
      expect(await journalEntryCount(f.org.orgId)).toBe(0);
    } finally { await cleanupOrg(f.org.orgId); }
  });
});
