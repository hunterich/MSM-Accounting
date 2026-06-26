/**
 * Read-side money-correctness integration tests for the PENDING_APPROVAL status.
 *
 * This branch introduced a `PENDING_APPROVAL` status (held = NOT posted to the
 * ledger). Two read-side queries used loose exclusion filters that wrongly
 * counted held (and, in the payment case, VOID) documents as live money:
 *
 *   1. reports/sales — `status: { not: 'VOID' }` counted PENDING_APPROVAL and
 *      DRAFT invoices as revenue, disagreeing with the GL-based P&L (which only
 *      sums POSTED journal lines). Fixed to a positive whitelist
 *      `status: { in: ['SENT', 'OVERDUE', 'PAID'] }` (matches reports/ar).
 *
 *   2. ar-payments / ap-payments over-allocation guard — the
 *      `aRPaymentAllocation.aggregate` / `aPPaymentAllocation.aggregate` had NO
 *      `payment.status` filter, so `alreadyPaid` included allocations from VOID
 *      (and PENDING_APPROVAL/DRAFT) payments → a real new payment was falsely
 *      blocked with "Over-allocation". Fixed by constraining the aggregate to
 *      `payment: { status: 'COMPLETED' }` (matches AR/AP aging).
 *
 * Run with:  npm run test:int -- reports-pending-approval
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
  cleanupOrg,
  disconnect,
} from './harness';
import { GET as getSalesReport } from '@/src/app/api/v1/reports/sales/route';
import { POST as postArPayment } from '@/src/app/api/v1/ar-payments/route';

afterAll(async () => {
  await disconnect();
});

const ISSUE_DATE = new Date('2026-03-15T00:00:00.000Z');

/**
 * Build a NextRequest carrying the auth headers the route reads. The actor is an
 * ADMIN (production middleware injects `x-role-type: 'ADMIN'` from the verified
 * JWT, which makes `requirePermission` bypass). The sales report GET is read by
 * orgId only and never looks the user up, so a synthetic `x-user-id` (required
 * by `authActor`) is sufficient here.
 */
function makeGet(url: string, orgId: string): NextRequest {
  const h = new Headers({
    'x-org-id': orgId,
    'x-user-id': `reports-reader-${randomUUID()}`,
    'x-role-type': 'ADMIN',
  });
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET', headers: h });
}

function makePost(url: string, orgId: string, userId: string, body: unknown): NextRequest {
  const h = new Headers({
    'x-org-id': orgId,
    'x-user-id': userId,
    'x-role-type': 'ADMIN',
    'content-type': 'application/json',
  });
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
  });
}

/** Seed a real User + ADMIN membership (the AR-payment POST requires x-user-id). */
async function seedAdmin(orgId: string): Promise<string> {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.local`,
      fullName: 'Reports Admin',
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

async function makeInvoice(
  orgId: string,
  customerId: string,
  status: 'SENT' | 'PENDING_APPROVAL' | 'DRAFT',
  totalAmount: number,
): Promise<string> {
  const inv = await prisma.salesInvoice.create({
    data: {
      organizationId: orgId,
      number: `INV-${randomUUID().slice(0, 8)}`,
      customerId,
      issueDate: ISSUE_DATE,
      status,
      subtotal: totalAmount,
      taxEnabled: false,
      taxAmount: 0,
      totalAmount,
      lines: {
        create: [
          {
            lineNo: 1,
            description: 'Widget',
            quantity: 1,
            unit: 'PCS',
            price: totalAmount,
            lineSubtotal: totalAmount,
          },
        ],
      },
    },
    select: { id: true },
  });
  return inv.id;
}

/* ------------------------------------------------------------------ */
/* Fix 1 — sales report must exclude held (PENDING_APPROVAL) + DRAFT   */
/* ------------------------------------------------------------------ */

describe('reports/sales excludes held + draft invoices from revenue totals', () => {
  it('by-customer grandTotal counts only the live SENT invoice (1,000,000), not the PENDING_APPROVAL one', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      await makeInvoice(org.orgId, customerId, 'SENT', 1_000_000);
      await makeInvoice(org.orgId, customerId, 'PENDING_APPROVAL', 500_000);

      const res = await getSalesReport(
        makeGet('/api/v1/reports/sales?type=by-customer', org.orgId),
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      // Held (PENDING_APPROVAL) invoice must NOT count as revenue.
      // Before the fix this was 1,500,000 (loose `status: { not: 'VOID' }`).
      expect(body.grandTotal).toBe(1_000_000);
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].total).toBe(1_000_000);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('history grandTotal excludes both PENDING_APPROVAL and DRAFT invoices', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      await makeInvoice(org.orgId, customerId, 'SENT', 1_000_000);
      await makeInvoice(org.orgId, customerId, 'PENDING_APPROVAL', 500_000);
      await makeInvoice(org.orgId, customerId, 'DRAFT', 250_000);

      const res = await getSalesReport(
        makeGet('/api/v1/reports/sales?type=history', org.orgId),
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.grandTotal).toBe(1_000_000);
      const statuses = body.rows.map((r: { status: string }) => r.status);
      expect(statuses).not.toContain('PENDING_APPROVAL');
      expect(statuses).not.toContain('DRAFT');
      expect(statuses).not.toContain('VOID');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Fix 2 — over-allocation guard ignores VOID-payment allocations      */
/* ------------------------------------------------------------------ */

describe('ar-payments over-allocation guard ignores VOID-payment allocations', () => {
  it('a VOID payment allocated to an invoice does NOT block a new COMPLETED payment up to the invoice total', async () => {
    const org = await createTestOrg();
    try {
      const adminId = await seedAdmin(org.orgId);
      const customerId = await createCustomer(org.orgId);

      // Invoice for 1,000,000 (must be a live status so it is a real receivable).
      const invoiceId = await makeInvoice(org.orgId, customerId, 'SENT', 1_000_000);

      // A pre-existing VOID payment that fully allocated the invoice. Because the
      // payment is VOID it cleared nothing — the invoice is still fully open.
      await prisma.aRPayment.create({
        data: {
          organizationId: org.orgId,
          number: `ARP-VOID-${randomUUID().slice(0, 8)}`,
          customerId,
          date: ISSUE_DATE,
          status: 'VOID',
          totalAmount: 1_000_000,
          allocations: { create: [{ invoiceId, amountApplied: 1_000_000 }] },
        },
      });

      // Sanity: the loose (buggy) aggregate WOULD see 1,000,000 already applied…
      const looseAgg = await prisma.aRPaymentAllocation.aggregate({
        where: { invoiceId },
        _sum: { amountApplied: true },
      });
      expect(Number(looseAgg._sum.amountApplied ?? 0)).toBe(1_000_000);

      // …but the fixed aggregate (COMPLETED-payment allocations only) sees 0.
      const completedAgg = await prisma.aRPaymentAllocation.aggregate({
        where: { invoiceId, payment: { status: 'COMPLETED' } },
        _sum: { amountApplied: true },
      });
      expect(Number(completedAgg._sum.amountApplied ?? 0)).toBe(0);

      // New, real COMPLETED payment allocating the full invoice total. This must
      // SUCCEED — before the fix the guard counted the VOID allocation and 422'd.
      const res = await postArPayment(
        makePost('/api/v1/ar-payments', org.orgId, adminId, {
          customerId,
          date: '2026-03-20',
          method: 'BANK_TRANSFER',
          status: 'COMPLETED',
          totalAmount: 1_000_000,
          allocations: [{ invoiceId, amountApplied: 1_000_000 }],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('COMPLETED');
      expect(body.allocations).toHaveLength(1);
      expect(Number(body.allocations[0].amountApplied)).toBe(1_000_000);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
