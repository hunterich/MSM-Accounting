/**
 * ACC-02 migration opening acceptance: an Accurate cutover entered through the
 * actual migration routes (create batch → stage → reconcile → commit), then
 * later invoices/bills and receipts/payments, with fixed values on the trial
 * balance, AR/AP aging, party balances, statements and the control GL.
 *
 * "Openings enter once" is proven three ways: the opening journal is the only
 * control posting for migrated documents; a second batch carrying openings is
 * refused (also when two commit at once); and rollback then re-import leaves
 * exactly one opening.
 *
 * Synthetic opening journals with customer/vendor seeds stay covered by
 * report-reconciliation.int.test.ts; commit/rollback mechanics by the other
 * migration-*.int.test.ts files.
 *
 * Run with:  npm run test:int -- migration-opening-acceptance
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect, assertTrialBalanced, type TestOrg } from './harness';
import { postInvoiceSend } from '../../invoice-send-posting';
import { postBillToLedger } from '../../bill-posting';
import { POST as createBatchRoute } from '@/src/app/api/v1/migration/batches/route';
import { POST as stageRoute } from '@/src/app/api/v1/migration/batches/[id]/stage/route';
import { GET as reconcileRoute } from '@/src/app/api/v1/migration/batches/[id]/reconcile/route';
import { POST as commitRoute } from '@/src/app/api/v1/migration/batches/[id]/commit/route';
import { POST as rollbackRoute } from '@/src/app/api/v1/migration/batches/[id]/rollback/route';
import { POST as createArPayment } from '@/src/app/api/v1/ar-payments/route';
import { POST as createApPayment } from '@/src/app/api/v1/ap-payments/route';
import { GET as arReport } from '@/src/app/api/v1/reports/ar/route';
import { GET as apReport } from '@/src/app/api/v1/reports/ap/route';
import { GET as glReport } from '@/src/app/api/v1/reports/gl/route';

afterAll(disconnect);

const CUTOVER = '2026-01-01';
const day = (d: string) => new Date(`${d}T00:00:00Z`);

interface Ctx { org: TestOrg; userId: string }

async function setup(): Promise<Ctx> {
  const org = await createTestOrg();
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' }, select: { id: true } });
  const user = await prisma.user.create({ data: { email: `u-${randomUUID()}@test.local`, fullName: 'Migration QA', passwordHash: 'x', status: 'ACTIVE' }, select: { id: true } });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: org.orgId, roleId: role.id } });
  return { org, userId: user.id };
}

function request(c: Ctx, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-org-id': c.org.orgId, 'x-user-id': c.userId, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Create a batch and stage every entity through the routes, as the migration wizard does. */
async function stageBatch(c: Ctx, staged: Record<string, unknown[]>): Promise<string> {
  const created = await createBatchRoute(request(c, '/api/v1/migration/batches', { cutoverDate: CUTOVER }));
  expect(created.status).toBe(200);
  const { id } = await created.json() as { id: string };
  for (const [entity, rows] of Object.entries(staged)) {
    const res = await stageRoute(request(c, `/api/v1/migration/batches/${id}/stage`, { entity, rows }), params(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ staged: rows.length, errors: [] });
  }
  return id;
}
async function commit(c: Ctx, id: string) {
  const res = await commitRoute(request(c, `/api/v1/migration/batches/${id}/commit`, {}), params(id));
  return { status: res.status, body: await res.json() as { committed?: boolean; error?: string } };
}

async function aging(c: Ctx, kind: 'ar' | 'ap', asOf: string) {
  const res = await (kind === 'ar' ? arReport : apReport)(request(c, `/api/v1/reports/${kind}?type=aging&asOfDate=${asOf}`));
  expect(res.status).toBe(200);
  const body = await res.json() as { rows: Array<Record<string, unknown>>; summary: { totalOutstanding: number; netOutstanding: number; d1To30: number; current: number }; warnings: string[] };
  expect(body.warnings).toEqual([]);
  return {
    total: body.summary.totalOutstanding,
    net: body.summary.netOutstanding,
    balances: Object.fromEntries(body.rows.map(r => [String(r[kind === 'ar' ? 'invoiceNumber' : 'billNumber']), r.balance as number])),
  };
}
async function partyBalance(c: Ctx, kind: 'ar' | 'ap', asOf: string): Promise<number> {
  const res = await (kind === 'ar' ? arReport : apReport)(request(c, `/api/v1/reports/${kind}?type=${kind === 'ar' ? 'customer-balance' : 'vendor-balance'}&asOfDate=${asOf}`));
  return (await res.json() as { summary: { totalOutstanding: number } }).summary.totalOutstanding;
}
/** Trial-balance route: net balance per account code in its natural direction. */
async function trialBalance(c: Ctx, asOf: string) {
  const res = await glReport(request(c, `/api/v1/reports/gl?type=trial-balance&asOfDate=${asOf}`));
  expect(res.status).toBe(200);
  const body = await res.json() as { rows: Array<{ accountCode: string; endingDebit: number; endingCredit: number }>; summary: { totalDebit: number; totalCredit: number } };
  expect(body.summary.totalDebit).toBe(body.summary.totalCredit);
  const by = (code: string) => body.rows.find(r => r.accountCode === code) ?? { endingDebit: 0, endingCredit: 0 };
  return {
    cash: by('1110').endingDebit - by('1110').endingCredit,
    ar: by('1210').endingDebit - by('1210').endingCredit,
    ap: by('2100').endingCredit - by('2100').endingDebit,
    equity: by('3900').endingCredit - by('3900').endingDebit,
    total: body.summary.totalDebit,
  };
}
const openingEntries = (c: Ctx) => prisma.journalEntry.count({ where: { organizationId: c.org.orgId, source: 'OPENING', status: 'POSTED' } });

const OPENING: Record<string, unknown[]> = {
  customers: [{ name: 'PT Alpha' }, { name: 'PT Beta' }],
  vendors: [{ name: 'CV Gamma' }],
  'opening-journal': [
    { accountCode: '1110', debit: 300_000 },
    { accountCode: '1210', debit: 1_500_000 },
    { accountCode: '2100', credit: 800_000 },
    { accountCode: '3900', credit: 1_000_000 },
  ],
  'opening-invoices': [
    { customerName: 'PT Alpha', invoiceNumber: 'OB-INV-1', issueDate: '2025-11-15', dueDate: '2025-12-15', amount: 1_000_000 },
    { customerName: 'PT Beta', invoiceNumber: 'OB-INV-2', issueDate: '2025-12-20', dueDate: '2026-01-19', amount: 500_000 },
  ],
  'opening-bills': [{ vendorName: 'CV Gamma', billNumber: 'OB-BILL-1', issueDate: '2025-12-10', dueDate: '2026-01-09', amount: 800_000 }],
};

describe('ACC-02 migration openings through the actual migration routes', () => {
  it('opening trial balance, customer/vendor seeds and open documents enter once and reconcile through later invoices, bills, receipts and payments', async () => {
    const c = await setup();
    const { org } = c;
    try {
      const discount = (await prisma.account.create({ data: { organizationId: org.orgId, code: '5350', name: 'Sales discount', type: 'EXPENSE', normalSide: 'DEBIT' } })).id;
      const penalty = (await prisma.account.create({ data: { organizationId: org.orgId, code: '5400', name: 'Vendor late fee', type: 'EXPENSE', normalSide: 'DEBIT' } })).id;
      const batchId = await stageBatch(c, OPENING);

      const preview = await reconcileRoute(request(c, `/api/v1/migration/batches/${batchId}/reconcile`), params(batchId));
      expect(await preview.json()).toMatchObject({ ok: true, checks: [
        { id: 'tb-balanced', expected: 1_800_000, actual: 1_800_000, pass: true },
        { id: 'ar-tie', expected: 1_500_000, actual: 1_500_000, pass: true },
        { id: 'ap-tie', expected: 800_000, actual: 800_000, pass: true },
        { id: 'inventory-tie', expected: 0, actual: 0, pass: true },
      ] });
      expect(await commit(c, batchId)).toMatchObject({ status: 200, body: { committed: true } });

      // The opening journal is the ONLY posting: migrated documents carry no journal.
      expect(await openingEntries(c)).toBe(1);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(1);
      expect(await prisma.journalLine.count({ where: { accountId: { in: [org.accounts.arControl, org.accounts.apControl] } } })).toBe(2);

      // Cutover day: the live trial balance equals the imported one, and the
      // subledgers equal their controls exactly once.
      expect(await trialBalance(c, CUTOVER)).toEqual({ cash: 300_000, ar: 1_500_000, ap: 800_000, equity: 1_000_000, total: 1_800_000 });
      expect(await aging(c, 'ar', CUTOVER)).toEqual({ total: 1_500_000, net: 1_500_000, balances: { 'OB-INV-1': 1_000_000, 'OB-INV-2': 500_000 } });
      expect(await aging(c, 'ap', CUTOVER)).toEqual({ total: 800_000, net: 800_000, balances: { 'OB-BILL-1': 800_000 } });
      expect(await partyBalance(c, 'ar', CUTOVER)).toBe(1_500_000);
      expect(await partyBalance(c, 'ap', CUTOVER)).toBe(800_000);
      const alpha = await prisma.customer.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'PT Alpha' }, select: { id: true, openingBalance: true, migrationBatchId: true } });
      const beta = await prisma.customer.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'PT Beta' }, select: { id: true } });
      const gamma = await prisma.vendor.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'CV Gamma' }, select: { id: true, openingBalance: true } });
      // Seeds carry no separate opening amount, so the debt is not counted twice.
      expect([Number(alpha.openingBalance), Number(gamma.openingBalance), alpha.migrationBatchId]).toEqual([0, 0, batchId]);
      const statement = await (await arReport(request(c, `/api/v1/reports/ar?type=statement&customerId=${alpha.id}&dateFrom=${CUTOVER}&dateTo=2026-01-31`))).json();
      expect(statement).toMatchObject({ openingBalance: 1_000_000, rows: [], summary: { closingBalance: 1_000_000 } });

      // Before the cutover the books hold no ledger: migrated documents appear
      // in aging under their source dates while the GL is still empty.
      expect((await trialBalance(c, '2025-12-31')).total).toBe(0);
      expect((await aging(c, 'ar', '2025-12-31')).total).toBe(1_500_000);

      // Later activity: a new invoice and bill, then receipts/payments that
      // settle migrated and new documents together.
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: alpha.id, number: 'INV-NEW', issueDate: day('2026-02-01'), dueDate: day('2026-03-03'),
        status: 'SENT', taxEnabled: false, subtotal: 200_000, taxAmount: 0, totalAmount: 200_000, lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: 200_000 }] } } });
      await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
      const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId: gamma.id, number: 'BILL-NEW', issueDate: day('2026-02-03'), dueDate: day('2026-03-05'),
        status: 'OPEN', taxable: false, subtotal: 300_000, taxAmount: 0, totalAmount: 300_000,
        lines: { create: [{ lineNo: 1, accountId: org.accounts.cogsExpense, description: 'Service', quantity: 1, price: 300_000, lineTotal: 300_000 }] } }, include: { lines: true } });
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      const ids = Object.fromEntries((await prisma.salesInvoice.findMany({ where: { organizationId: org.orgId }, select: { id: true, number: true } })).map(d => [d.number, d.id]));
      const billIds = Object.fromEntries((await prisma.bill.findMany({ where: { organizationId: org.orgId }, select: { id: true, number: true } })).map(d => [d.number, d.id]));

      const receipt = async (customerId: string, date: string, totalAmount: number, allocations: unknown[]) =>
        createArPayment(request(c, '/api/v1/ar-payments', { customerId, date, method: 'BANK_TRANSFER', status: 'COMPLETED', totalAmount,
          depositAccountId: org.accounts.bankAsset, arAccountId: org.accounts.arControl, discountAccountId: discount, allocations }));
      // Alpha: 990,000 + 10,000 discount clears OB-INV-1; 50,000 part-pays INV-NEW.
      expect((await receipt(alpha.id, '2026-02-10', 1_040_000, [
        { invoiceId: ids['OB-INV-1'], amountApplied: 990_000, discountAmount: 10_000 },
        { invoiceId: ids['INV-NEW'], amountApplied: 50_000 },
      ])).status).toBe(201);
      expect((await receipt(beta.id, '2026-02-12', 200_000, [{ invoiceId: ids['OB-INV-2'], amountApplied: 200_000 }])).status).toBe(201);
      // Gamma: 805,000 cash = OB-BILL-1 800,000 + 5,000 late fee.
      const paid = await createApPayment(request(c, '/api/v1/ap-payments', { vendorId: gamma.id, date: '2026-02-15', method: 'BANK_TRANSFER', status: 'COMPLETED', totalAmount: 805_000,
        cashAccountId: org.accounts.bankAsset, apAccountId: org.accounts.apControl, penaltyAccountId: penalty,
        allocations: [{ billId: billIds['OB-BILL-1'], amountApplied: 800_000, penaltyAmount: 5_000 }] }));
      expect(paid.status).toBe(201);

      // January is still exactly the openings.
      expect(await trialBalance(c, '2026-01-31')).toEqual({ cash: 300_000, ar: 1_500_000, ap: 800_000, equity: 1_000_000, total: 1_800_000 });
      expect((await aging(c, 'ar', '2026-01-31')).total).toBe(1_500_000);
      expect((await aging(c, 'ap', '2026-01-31')).total).toBe(800_000);

      // End of February: subledgers equal their controls; the openings were
      // settled once and are not still carried anywhere.
      const feb = await trialBalance(c, '2026-02-28');
      expect({ cash: feb.cash, ar: feb.ar, ap: feb.ap, equity: feb.equity }).toEqual({ cash: 735_000, ar: 450_000, ap: 300_000, equity: 1_000_000 });
      expect(await aging(c, 'ar', '2026-02-28')).toEqual({ total: 450_000, net: 450_000, balances: { 'OB-INV-2': 300_000, 'INV-NEW': 150_000 } });
      expect(await aging(c, 'ap', '2026-02-28')).toEqual({ total: 300_000, net: 300_000, balances: { 'BILL-NEW': 300_000 } });
      expect(await partyBalance(c, 'ar', '2026-02-28')).toBe(450_000);
      expect(await partyBalance(c, 'ap', '2026-02-28')).toBe(300_000);
      const statuses = await prisma.salesInvoice.findMany({ where: { organizationId: org.orgId }, select: { number: true, status: true }, orderBy: { number: 'asc' } });
      expect(statuses).toEqual([{ number: 'INV-NEW', status: 'SENT' }, { number: 'OB-INV-1', status: 'PAID' }, { number: 'OB-INV-2', status: 'SENT' }]);
      expect((await prisma.bill.findUniqueOrThrow({ where: { id: billIds['OB-BILL-1'] }, select: { status: true } })).status).toBe('PAID');
      const febStatement = await (await arReport(request(c, `/api/v1/reports/ar?type=statement&customerId=${alpha.id}&dateFrom=2026-02-01&dateTo=2026-02-28`))).json();
      expect(febStatement).toMatchObject({ openingBalance: 1_000_000, summary: { closingBalance: 150_000 } });
      expect(await openingEntries(c)).toBe(1);
      await assertTrialBalanced(org.orgId, 'migration');

      // Live activity now depends on the openings: rollback refuses and removes nothing.
      const rollback = await rollbackRoute(request(c, `/api/v1/migration/batches/${batchId}/rollback`, {}), params(batchId));
      expect(await rollback.json()).toMatchObject({ rolledBack: false });
      expect(await openingEntries(c)).toBe(1);
      expect((await aging(c, 'ar', '2026-02-28')).total).toBe(450_000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a second batch carrying openings is refused; master-only batches still commit; rollback then re-import enters once', async () => {
    const c = await setup();
    const { org } = c;
    try {
      // Unnumbered rows: nothing but this guard stops a re-imported file.
      const staged = {
        customers: [{ name: 'PT Alpha' }],
        'opening-journal': [{ accountCode: '1210', debit: 1_000 }, { accountCode: '3900', credit: 1_000 }],
        'opening-invoices': [{ customerName: 'PT Alpha', issueDate: '2025-12-01', amount: 1_000 }],
      };
      const first = await stageBatch(c, staged);
      expect(await commit(c, first)).toMatchObject({ status: 200, body: { committed: true } });

      const again = await stageBatch(c, staged);
      const refused = await commit(c, again);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatch(/Opening balances were already committed by the migration batch with cutover 2026-01-01/);
      expect((await prisma.migrationBatch.findUniqueOrThrow({ where: { id: again }, select: { status: true } })).status).toBe('DRAFT');
      expect(await prisma.customer.count({ where: { organizationId: org.orgId } })).toBe(1);
      expect(await openingEntries(c)).toBe(1);
      expect((await trialBalance(c, '2026-01-31')).ar).toBe(1_000);
      expect(await aging(c, 'ar', '2026-01-31')).toMatchObject({ total: 1_000, balances: { 'INV-000001': 1_000 } });

      // Opening stock is an opening too; a vendor/account-only batch is not.
      const stock = await stageBatch(c, { items: [{ name: 'Widget', type: 'PRODUCT', openingStock: 1, openingValue: 0 }] });
      expect((await commit(c, stock)).status).toBe(409);
      const masters = await stageBatch(c, { vendors: [{ name: 'CV Later' }], accounts: [{ code: '6100', name: 'Rent', type: 'EXPENSE' }] });
      expect(await commit(c, masters)).toMatchObject({ status: 200, body: { committed: true } });

      // Rolling back the first batch frees the opening; the re-import then enters once.
      const rolledBack = await rollbackRoute(request(c, `/api/v1/migration/batches/${first}/rollback`, {}), params(first));
      expect(await rolledBack.json()).toEqual({ rolledBack: true });
      expect((await trialBalance(c, '2026-01-31')).ar).toBe(0);
      expect((await aging(c, 'ar', '2026-01-31')).total).toBe(0);
      expect(await commit(c, again)).toMatchObject({ status: 200, body: { committed: true } });
      expect(await openingEntries(c)).toBe(1);
      expect(await prisma.customer.count({ where: { organizationId: org.orgId } })).toBe(1);
      expect((await trialBalance(c, '2026-01-31')).ar).toBe(1_000);
      expect((await aging(c, 'ar', '2026-01-31')).total).toBe(1_000);
      expect(await partyBalance(c, 'ar', '2026-01-31')).toBe(1_000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('two opening batches committed at the same time: exactly one enters', async () => {
    const c = await setup();
    try {
      // Existing customers and distinct numbers, so no unique key can stand in
      // for the opening guard.
      for (const [code, name] of [['C-1', 'PT One'], ['C-2', 'PT Two']]) {
        await prisma.customer.create({ data: { organizationId: c.org.orgId, code, name } });
      }
      const staged = (name: string, number: string) => ({
        'opening-journal': [{ accountCode: '1210', debit: 2_500 }, { accountCode: '3900', credit: 2_500 }],
        'opening-invoices': [{ customerName: name, invoiceNumber: number, issueDate: '2025-12-01', amount: 2_500 }],
      });
      const [a, b] = [await stageBatch(c, staged('PT One', 'OB-1')), await stageBatch(c, staged('PT Two', 'OB-2'))];
      const results = await Promise.all([commit(c, a), commit(c, b)]);
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      expect(results.find(r => r.status === 409)!.body.error).toMatch(/Opening balances were already committed/);
      expect(await prisma.migrationBatch.count({ where: { organizationId: c.org.orgId, status: 'COMMITTED' } })).toBe(1);
      expect(await openingEntries(c)).toBe(1);
      expect(await prisma.salesInvoice.count({ where: { organizationId: c.org.orgId } })).toBe(1);
      expect((await trialBalance(c, '2026-01-31')).ar).toBe(2_500);
      expect((await aging(c, 'ar', '2026-01-31')).total).toBe(2_500);
    } finally { await cleanupOrg(c.org.orgId); }
  });
});
