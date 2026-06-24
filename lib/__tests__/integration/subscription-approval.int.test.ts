/**
 * Subscription invoice generation × approval-gate × atomic-claim integration tests.
 *
 * Proves three fixes to src/app/api/v1/subscriptions/generate-invoices/route.ts,
 * the same family already fixed for recurring invoices/bills:
 *
 *   1. GL posted — a live SENT subscription invoice must carry a balanced JE
 *      (AR/Sales). Previously this route created a SENT invoice and posted
 *      NOTHING → revenue silently unrecorded.
 *   2. Approval gate — when ar_invoices approval is required the generated
 *      invoice must be HELD (PENDING_APPROVAL) with one PENDING ApprovalRequest
 *      and zero GL, not go live and skip the gate.
 *   3. Atomic claim — the per-subscription period advance is a guarded
 *      conditional update done BEFORE the invoice is created, so running the
 *      generator twice for the same due subscription creates exactly ONE
 *      invoice (the second run claims 0 rows and generates nothing).
 *
 * These exercise the REAL Next.js route handler end-to-end against the
 * `<db>_test` database. The handler imports the shared `@/lib/prisma` client;
 * the setupFiles entry repoints that client's DATABASE_URL at `_test` before any
 * module loads, so handler writes and harness seeds hit the same DB.
 *
 * Run with:  npm run test:int -- subscription-approval
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
  journalEntryCount,
  assertTrialBalanced,
  cleanupOrg,
  disconnect,
} from './harness';
import { POST as generateSubscriptionInvoices } from '@/src/app/api/v1/subscriptions/generate-invoices/route';

afterAll(async () => {
  await disconnect();
});

// Anchored to "now" so the test holds regardless of wall-clock date. The route
// compares nextInvoiceDate against `new Date()`, and after the atomic claim it
// advances nextInvoiceDate to (next period end − 7 days). We want the seeded sub
// to be due now BUT a single advance to push nextInvoiceDate into the future, so
// the "twice" run finds nothing due the second time (it bills the current period
// once, not catch-up multiple stale periods). A ~3-day-ago period end gives an
// advance of roughly +(1 month − 7 days) ≈ +3 weeks past today.
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}
const PERIOD_START = daysFromNow(-33); // current period started ~a month ago
const PERIOD_END = daysFromNow(-3); // current period just ended → invoice due
const DUE_DATE = daysFromNow(-3); // nextInvoiceDate in the (recent) past

/**
 * Seed an ADMIN Role + User + UserOrganization. The route attributes the held
 * ApprovalRequest to x-user-id when present, else falls back to the org ADMIN
 * membership. Either way a real User must exist for the requestedById FK.
 */
async function seedAdmin(orgId: string): Promise<string> {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.local`,
      fullName: 'Subscription Admin',
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

/**
 * Seed an ACTIVE monthly subscription + plan + customer that is due today
 * (nextInvoiceDate in the past). Returns the subscription id.
 */
async function makeDueSubscription(orgId: string, customerId: string): Promise<string> {
  const plan = await prisma.subscriptionPlan.create({
    data: {
      organizationId: orgId,
      name: `Plan ${randomUUID().slice(0, 8)}`,
      price: 100000,
      interval: 'MONTHLY',
    },
    select: { id: true },
  });
  const sub = await prisma.subscription.create({
    data: {
      organizationId: orgId,
      customerId,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: PERIOD_START,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      nextInvoiceDate: DUE_DATE,
    },
    select: { id: true },
  });
  return sub.id;
}

/** Build a NextRequest carrying the auth headers the route reads. */
function authedRequest(headers: { orgId: string; userId?: string }): NextRequest {
  const h = new Headers({ 'x-org-id': headers.orgId });
  if (headers.userId) h.set('x-user-id', headers.userId);
  return new NextRequest(new URL('/api/v1/subscriptions/generate-invoices', 'http://localhost'), {
    method: 'POST',
    headers: h,
  });
}

describe('subscription invoice generation × approval gate × atomic claim', () => {
  it('approval OFF → invoice SENT, a balanced JE is posted, and nextInvoiceDate advances', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', false);
      const customerId = await createCustomer(org.orgId);
      const subId = await makeDueSubscription(org.orgId, customerId);

      const res = await generateSubscriptionInvoices(
        authedRequest({ orgId: org.orgId, userId: admin }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.generated).toBe(1);

      const invoices = await prisma.salesInvoice.findMany({
        where: { organizationId: org.orgId },
        select: { id: true, status: true },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe('SENT');

      // No approval request when the gate is off.
      const requests = await prisma.approvalRequest.count({
        where: { organizationId: org.orgId, documentType: 'INVOICE' },
      });
      expect(requests).toBe(0);

      // Regression guard for the silent-revenue bug: a live SENT invoice must
      // carry GL behind it. Previously this route posted NOTHING.
      expect(await journalEntryCount(org.orgId)).toBeGreaterThanOrEqual(1);
      await assertTrialBalanced(org.orgId, 'subscription approval-off');

      // The period was advanced (nextInvoiceDate moved forward off DUE_DATE).
      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subId },
        select: { nextInvoiceDate: true },
      });
      expect(sub.nextInvoiceDate).not.toBeNull();
      expect(sub.nextInvoiceDate!.getTime()).toBeGreaterThan(DUE_DATE.getTime());
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('ar_invoices ON → invoice HELD (PENDING_APPROVAL), one PENDING request, zero JE', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      await makeDueSubscription(org.orgId, customerId);

      const res = await generateSubscriptionInvoices(
        authedRequest({ orgId: org.orgId, userId: admin }),
      );
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
        where: {
          organizationId: org.orgId,
          documentType: 'INVOICE',
          documentId: invoices[0].id,
          status: 'PENDING',
        },
        select: { requestedById: true },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].requestedById).toBe(admin);

      // Held → nothing posted to the GL.
      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('running the generator TWICE for the same due sub creates exactly ONE invoice', async () => {
    const org = await createTestOrg();
    try {
      const admin = await seedAdmin(org.orgId);
      await setRequirement(org.orgId, 'ar_invoices', false);
      const customerId = await createCustomer(org.orgId);
      await makeDueSubscription(org.orgId, customerId);

      const first = await generateSubscriptionInvoices(
        authedRequest({ orgId: org.orgId, userId: admin }),
      );
      expect((await first.json()).generated).toBe(1);

      // Second run: the period was already claimed/advanced, so nothing is due.
      const second = await generateSubscriptionInvoices(
        authedRequest({ orgId: org.orgId, userId: admin }),
      );
      expect((await second.json()).generated).toBe(0);

      const invoices = await prisma.salesInvoice.count({
        where: { organizationId: org.orgId },
      });
      expect(invoices).toBe(1);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('no x-user-id and no org admin → 401 (refuses rather than routing with a null requester)', async () => {
    const org = await createTestOrg();
    try {
      // Deliberately do NOT seed an admin.
      await setRequirement(org.orgId, 'ar_invoices', true);
      const customerId = await createCustomer(org.orgId);
      await makeDueSubscription(org.orgId, customerId);

      const res = await generateSubscriptionInvoices(authedRequest({ orgId: org.orgId }));
      expect(res.status).toBe(401);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
