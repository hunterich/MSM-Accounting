/**
 * Recurring auto-post × approval-gate integration tests.
 *
 * Proves the code-review bypass fix: when a recurring template has
 * autoPost=true, the generated invoice/bill must NOT go live (SENT/OPEN) while
 * ar_invoices / ap_bills approval is required — it must be HELD
 * (PENDING_APPROVAL) with a PENDING ApprovalRequest and zero GL posted. With
 * approval OFF the auto-post status is produced as before.
 *
 * These exercise the REAL Next.js route handlers (the generate and run POST
 * functions) end-to-end against the `<db>_test` database, so they actually test
 * the wiring — including the routeForApproval call inside the route's
 * transaction and the x-user-id → ApprovalRequest.requestedById attribution.
 *
 * The route handlers import the shared `@/lib/prisma` client; the setupFiles
 * entry (setup-test-db-env.ts) repoints that client's DATABASE_URL at `_test`
 * before any module loads, so handler writes and harness seeds hit the same DB.
 *
 * Run with:  npm run test:int -- recurring-approval
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed (`npm run test:int:setup`).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createVendor,
  journalEntryCount,
  assertTrialBalanced,
  accountBalance,
  cleanupOrg,
  disconnect,
} from './harness';
import { POST as generateInvoice } from '@/src/app/api/v1/recurring-invoices/[id]/generate/route';
import { POST as runInvoices } from '@/src/app/api/v1/recurring-invoices/run/route';
import { POST as generateBill } from '@/src/app/api/v1/recurring-bills/[id]/generate/route';

afterAll(async () => {
  await disconnect();
});

/** A date in the past so `run` (nextRunDate <= today) picks the template up. */
const PAST = new Date('2026-01-10T00:00:00.000Z');

/**
 * Seed an ADMIN Role + User + UserOrganization. The generate routes attribute
 * the held ApprovalRequest to the x-user-id header; the run routes fall back to
 * the org's ADMIN membership when no header is present. Either way a real User
 * must exist for the requestedById FK.
 */
async function seedAdmin(orgId: string): Promise<string> {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.local`,
      fullName: 'Recurring Admin',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgId, roleId: role.id },
  });
  return user.id;
}

async function setRequirement(orgId: string, configKey: string, on: boolean): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { approvalRequirements: { [configKey]: on } },
  });
}

async function makeRecurringInvoiceTemplate(
  orgId: string,
  customerId: string,
  autoPost: boolean,
): Promise<string> {
  const tpl = await prisma.recurringInvoice.create({
    data: {
      organizationId: orgId,
      customerId,
      title: `Monthly retainer ${randomUUID().slice(0, 8)}`,
      frequency: 'MONTHLY',
      startDate: PAST,
      nextRunDate: PAST,
      status: 'ACTIVE',
      autoPost,
      taxRate: 0,
      lines: {
        create: [
          { lineNo: 1, description: 'Service', quantity: 1, price: 100000, discountPct: 0, taxable: false },
        ],
      },
    },
    select: { id: true },
  });
  return tpl.id;
}

async function makeRecurringBillTemplate(
  orgId: string,
  vendorId: string,
  autoPost: boolean,
): Promise<string> {
  const tpl = await prisma.recurringBill.create({
    data: {
      organizationId: orgId,
      vendorId,
      title: `Monthly rent ${randomUUID().slice(0, 8)}`,
      frequency: 'MONTHLY',
      startDate: PAST,
      nextRunDate: PAST,
      status: 'ACTIVE',
      autoPost,
      taxRate: 0,
      lines: {
        create: [
          { lineNo: 1, description: 'Rent', quantity: 1, price: 100000, discountPct: 0, taxable: false },
        ],
      },
    },
    select: { id: true },
  });
  return tpl.id;
}

/**
 * A recurring BILL template whose single line IS taxable, at the given taxRate.
 * Used to prove PPN is booked to the Input Tax account (apTax) rather than
 * buried in the expense debit. Returns the template id + the line amount so the
 * test can compute the expected tax = amount * rate.
 */
async function makeTaxableRecurringBillTemplate(
  orgId: string,
  vendorId: string,
  autoPost: boolean,
  taxRate = 11,
  lineAmount = 100000,
): Promise<{ tplId: string; lineAmount: number; taxRate: number }> {
  const tpl = await prisma.recurringBill.create({
    data: {
      organizationId: orgId,
      vendorId,
      title: `Taxable rent ${randomUUID().slice(0, 8)}`,
      frequency: 'MONTHLY',
      startDate: PAST,
      nextRunDate: PAST,
      status: 'ACTIVE',
      autoPost,
      taxRate,
      lines: {
        create: [
          { lineNo: 1, description: 'Rent', quantity: 1, price: lineAmount, discountPct: 0, taxable: true },
        ],
      },
    },
    select: { id: true },
  });
  return { tplId: tpl.id, lineAmount, taxRate };
}

/**
 * Build a NextRequest carrying the auth headers the route reads. The seeded
 * actor is an ADMIN (seedAdmin), so we mirror what `src/middleware.ts` injects
 * from the verified JWT: `x-role-type: 'ADMIN'` makes `requirePermission` bypass.
 */
function authedRequest(
  url: string,
  headers: { orgId: string; userId?: string },
): NextRequest {
  const h = new Headers({ 'x-org-id': headers.orgId, 'x-role-type': 'ADMIN' });
  if (headers.userId) h.set('x-user-id', headers.userId);
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'POST', headers: h });
}

/* ------------------------------------------------------------------ */
/* recurring-invoices/[id]/generate                                    */
/* ------------------------------------------------------------------ */

describe('recurring invoice generate × approval gate', () => {
  it('ar_invoices ON + autoPost → invoice HELD (PENDING_APPROVAL), one PENDING request, zero JE', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      const tplId = await makeRecurringInvoiceTemplate(org.orgId, customerId, true);

      const req = authedRequest(
        `/api/v1/recurring-invoices/${tplId}/generate`,
        { orgId: org.orgId, userId: admin },
      );
      const res = await generateInvoice(req, { params: Promise.resolve({ id: tplId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('PENDING_APPROVAL');

      const invoice = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: body.invoiceId },
        select: { status: true },
      });
      expect(invoice.status).toBe('PENDING_APPROVAL');

      const pending = await prisma.approvalRequest.findMany({
        where: {
          organizationId: org.orgId,
          documentType: 'INVOICE',
          documentId: body.invoiceId,
          status: 'PENDING',
        },
        select: { requestedById: true },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].requestedById).toBe(admin);

      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('ar_invoices OFF + autoPost → invoice goes live (SENT), no approval request, AND a balanced JE is posted', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', false);
      const customerId = await createCustomer(org.orgId);
      const tplId = await makeRecurringInvoiceTemplate(org.orgId, customerId, true);

      const req = authedRequest(
        `/api/v1/recurring-invoices/${tplId}/generate`,
        { orgId: org.orgId, userId: admin },
      );
      const res = await generateInvoice(req, { params: Promise.resolve({ id: tplId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('SENT');

      const invoice = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: body.invoiceId },
        select: { status: true },
      });
      expect(invoice.status).toBe('SENT');

      const requests = await prisma.approvalRequest.count({
        where: { organizationId: org.orgId, documentType: 'INVOICE', documentId: body.invoiceId },
      });
      expect(requests).toBe(0);

      // Regression guard for the silent-revenue bug: a live SENT invoice must
      // carry GL behind it. Previously this branch posted NOTHING (count 0).
      expect(await journalEntryCount(org.orgId)).toBeGreaterThanOrEqual(1);
      await assertTrialBalanced(org.orgId, 'invoice autoPost approval-off');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('ar_invoices ON + autoPost FALSE → DRAFT invoice, never gated (drafts do not go live)', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      const tplId = await makeRecurringInvoiceTemplate(org.orgId, customerId, false);

      const req = authedRequest(
        `/api/v1/recurring-invoices/${tplId}/generate`,
        { orgId: org.orgId, userId: admin },
      );
      const res = await generateInvoice(req, { params: Promise.resolve({ id: tplId }) });
      const body = await res.json();
      expect(body.status).toBe('DRAFT');
      expect(
        (await prisma.salesInvoice.findUniqueOrThrow({ where: { id: body.invoiceId }, select: { status: true } }))
          .status,
      ).toBe('DRAFT');
      const requests = await prisma.approvalRequest.count({
        where: { organizationId: org.orgId, documentType: 'INVOICE', documentId: body.invoiceId },
      });
      expect(requests).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('generate with no x-user-id → 401 (refuses rather than routing with a null requester)', async () => {
    const org = await createTestOrg();
    try {
      await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      const tplId = await makeRecurringInvoiceTemplate(org.orgId, customerId, true);

      const req = authedRequest(
        `/api/v1/recurring-invoices/${tplId}/generate`,
        { orgId: org.orgId }, // no userId
      );
      const res = await generateInvoice(req, { params: Promise.resolve({ id: tplId }) });
      expect(res.status).toBe(401);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* recurring-invoices/run (batch)                                      */
/* ------------------------------------------------------------------ */

describe('recurring invoice run (batch) × approval gate', () => {
  it('ar_invoices ON + autoPost, run with x-user-id → generated invoice HELD, PENDING request, zero JE', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      await makeRecurringInvoiceTemplate(org.orgId, customerId, true);

      const req = authedRequest('/api/v1/recurring-invoices/run', { orgId: org.orgId, userId: admin });
      const res = await runInvoices(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.generated).toBe(1);

      const invoices = await prisma.salesInvoice.findMany({
        where: { organizationId: org.orgId },
        select: { id: true, status: true },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe('PENDING_APPROVAL');

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'INVOICE', status: 'PENDING' },
        select: { requestedById: true },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].requestedById).toBe(admin);

      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('run with NO x-user-id → 401 (server-side authz requires authentication; no unauthenticated batch run)', async () => {
    const org = await createTestOrg();
    try {
      await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      await makeRecurringInvoiceTemplate(org.orgId, customerId, true);

      // No x-user-id header. With the server-side authorization layer, every
      // /api/v1 route is authenticated by middleware (which injects x-user-id
      // from the verified session). A request without it is rejected up-front,
      // so an unauthenticated caller can NOT trigger a batch run. The real
      // scheduler invokes a lib function, not this HTTP route.
      const req = authedRequest('/api/v1/recurring-invoices/run', { orgId: org.orgId });
      const res = await runInvoices(req);
      expect(res.status).toBe(401);

      // Nothing was generated — no bypass.
      expect(await prisma.salesInvoice.count({ where: { organizationId: org.orgId } })).toBe(0);
      expect(await prisma.approvalRequest.count({ where: { organizationId: org.orgId } })).toBe(0);
      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* recurring-bills/[id]/generate                                       */
/* ------------------------------------------------------------------ */

describe('recurring bill generate × approval gate', () => {
  it('ap_bills ON + autoPost → bill HELD (PENDING_APPROVAL), one PENDING request, zero JE', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ap_bills', true);
      const vendorId = await createVendor(org.orgId);
      const tplId = await makeRecurringBillTemplate(org.orgId, vendorId, true);

      const req = authedRequest(
        `/api/v1/recurring-bills/${tplId}/generate`,
        { orgId: org.orgId, userId: admin },
      );
      const res = await generateBill(req, { params: Promise.resolve({ id: tplId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('PENDING_APPROVAL');

      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: body.billId }, select: { status: true } })).status,
      ).toBe('PENDING_APPROVAL');

      const pending = await prisma.approvalRequest.findMany({
        where: {
          organizationId: org.orgId,
          documentType: 'BILL',
          documentId: body.billId,
          status: 'PENDING',
        },
        select: { requestedById: true },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].requestedById).toBe(admin);

      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('ap_bills OFF + autoPost → bill goes live (OPEN), no approval request, AND a balanced JE is posted', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ap_bills', false);
      const vendorId = await createVendor(org.orgId);
      const tplId = await makeRecurringBillTemplate(org.orgId, vendorId, true);

      const req = authedRequest(
        `/api/v1/recurring-bills/${tplId}/generate`,
        { orgId: org.orgId, userId: admin },
      );
      const res = await generateBill(req, { params: Promise.resolve({ id: tplId }) });
      const body = await res.json();
      expect(body.status).toBe('OPEN');
      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: body.billId }, select: { status: true } })).status,
      ).toBe('OPEN');
      const requests = await prisma.approvalRequest.count({
        where: { organizationId: org.orgId, documentType: 'BILL', documentId: body.billId },
      });
      expect(requests).toBe(0);

      // Regression guard for the silent-expense bug: a live OPEN bill must carry
      // GL behind it (expense + AP). Previously this branch posted NOTHING.
      expect(await journalEntryCount(org.orgId)).toBeGreaterThanOrEqual(1);
      await assertTrialBalanced(org.orgId, 'bill autoPost approval-off');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('ap_bills OFF + autoPost + TAXABLE line → PPN booked to Input Tax (apTax), not buried in expense', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ap_bills', false);
      const vendorId = await createVendor(org.orgId);
      const { tplId, lineAmount, taxRate } = await makeTaxableRecurringBillTemplate(
        org.orgId,
        vendorId,
        true, // autoPost
        11,   // PPN 11%
      );
      const expectedTax = Math.round(lineAmount * (taxRate / 100) * 100) / 100; // 11000

      const req = authedRequest(
        `/api/v1/recurring-bills/${tplId}/generate`,
        { orgId: org.orgId, userId: admin },
      );
      const res = await generateBill(req, { params: Promise.resolve({ id: tplId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('OPEN');

      // The generated bill carries the tax flag so postBillToLedger classifies PPN.
      const bill = await prisma.bill.findUniqueOrThrow({
        where: { id: body.billId },
        select: { status: true, taxable: true, taxInclusive: true, taxAmount: true, totalAmount: true },
      });
      expect(bill.status).toBe('OPEN');
      expect(bill.taxable).toBe(true);
      expect(bill.taxInclusive).toBe(false);
      expect(Number(bill.taxAmount)).toBeCloseTo(expectedTax, 2);
      expect(Number(bill.totalAmount)).toBeCloseTo(lineAmount + expectedTax, 2);

      // A balanced JE exists...
      expect(await journalEntryCount(org.orgId)).toBeGreaterThanOrEqual(1);
      await assertTrialBalanced(org.orgId, 'taxable bill autoPost approval-off');

      // ...and the PPN lands as a DEBIT on the Input Tax (apTax) account equal to
      // the expected tax. BEFORE the fix the bill was created with taxable=false,
      // so postBillToLedger booked NO input-tax line (PPN buried in the expense
      // debit) and this balance would be 0.
      const inputTaxDr = await accountBalance(org.orgId, org.accounts.apTax);
      expect(inputTaxDr).toBeCloseTo(expectedTax, 2);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
