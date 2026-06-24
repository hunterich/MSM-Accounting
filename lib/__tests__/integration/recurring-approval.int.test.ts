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

/** Build a NextRequest carrying the auth headers the route reads. */
function authedRequest(
  url: string,
  headers: { orgId: string; userId?: string },
): NextRequest {
  const h = new Headers({ 'x-org-id': headers.orgId });
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

  it('ar_invoices OFF + autoPost → invoice goes live (SENT) as before, no approval request', async () => {
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

  it('ar_invoices ON + autoPost, run with NO x-user-id → falls back to org admin as requester (no bypass)', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      await makeRecurringInvoiceTemplate(org.orgId, customerId, true);

      const req = authedRequest('/api/v1/recurring-invoices/run', { orgId: org.orgId }); // scheduler path
      const res = await runInvoices(req);
      expect(res.status).toBe(200);

      const invoices = await prisma.salesInvoice.findMany({
        where: { organizationId: org.orgId },
        select: { status: true },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe('PENDING_APPROVAL');

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'INVOICE', status: 'PENDING' },
        select: { requestedById: true },
      });
      expect(pending).toHaveLength(1);
      // Attributed to the seeded org admin, not skipped.
      expect(pending[0].requestedById).toBe(admin);
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

  it('ap_bills OFF + autoPost → bill goes live (OPEN) as before, no approval request', async () => {
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
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
