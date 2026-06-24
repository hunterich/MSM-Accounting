/**
 * Approval-engine CONCURRENCY integration tests — exercise the REAL engine
 * (routeForApproval / approveRequest) against a real Postgres `<db>_test`
 * database and assert the three correctness invariants that only surface under
 * concurrent finalize / approve traffic and stale-state edits:
 *
 *   Bug A — duplicate PENDING (TOCTOU): two concurrent finalizes for the SAME
 *           document must NOT each create a PENDING ApprovalRequest. Exactly one
 *           open PENDING must exist.
 *   Bug B — double-post on concurrent approve: two concurrent approveRequest
 *           calls on the same request must NOT both run the finalizer. Exactly
 *           one wins; the document posts to the GL exactly once.
 *   Bug C — stale approval blesses later edits: a past APPROVED request must NOT
 *           let a later finalize (after revert→edit→re-send) skip approval. A
 *           fresh PENDING request must be required.
 *
 * Run with:  npm run test:int
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed AND the partial-unique backstop index applied
 *            (`npm run test:int:setup`).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  createTestOrg,
  createCustomer,
  assertTrialBalanced,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';
import { routeForApproval, approveRequest } from '../../approval/engine';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-04-10T00:00:00.000Z');

/**
 * Seed a Role (+RolePermission on AR_INVOICES) + User + UserOrganization inline.
 * Copied from approval-engine.int.test.ts — the harness's createTestOrg does NOT
 * create users/roles, so the approval-authz path needs this scaffolding.
 */
async function seedUser(
  orgId: string,
  roleType: 'ADMIN' | 'ACCOUNTANT',
  canApprove: boolean,
): Promise<string> {
  const role = await prisma.role.create({
    data: {
      organizationId: orgId,
      name: `${roleType}-${canApprove}-${randomUUID()}`,
      roleType,
      permissions: {
        create: [
          { moduleKey: 'AR_INVOICES', canView: true, canCreate: true, canEdit: true, canApprove },
        ],
      },
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.local`,
      fullName: 'Test User',
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

async function setRequirement(orgId: string, on: boolean): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { approvalRequirements: { ar_invoices: on } },
  });
}

/**
 * Build a DRAFT invoice that POSTs a balanced JE when sent (one description-only
 * line, no tax/discount → clean AR (Dr) / Sales (Cr) pair). Copied from
 * approval-engine.int.test.ts.
 */
async function makeDraftInvoice(orgId: string): Promise<string> {
  const customerId = await createCustomer(orgId);
  const invoice = await prisma.salesInvoice.create({
    data: {
      organizationId: orgId,
      number: `INV-${randomUUID().slice(0, 8)}`,
      customerId,
      issueDate: DATE,
      status: 'DRAFT',
      taxEnabled: false,
      taxAmount: 0,
      discountAmount: 0,
      subtotal: 100000,
      totalAmount: 100000,
      lines: {
        create: [
          {
            lineNo: 1,
            description: 'Consulting service',
            quantity: 1,
            unit: 'PCS',
            price: 100000,
            lineSubtotal: 100000,
          },
        ],
      },
    },
    select: { id: true },
  });
  return invoice.id;
}

describe('approval engine: concurrency + stale-state correctness', () => {
  it('Bug A — two concurrent finalizes create exactly ONE open PENDING request', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const invoiceId = await makeDraftInvoice(org.orgId);

      const routeOnce = () =>
        prisma.$transaction((tx) =>
          routeForApproval(tx, {
            orgId: org.orgId,
            userId: submitter,
            documentType: 'INVOICE',
            documentId: invoiceId,
          }),
        );

      // Fire two concurrent finalizes for the SAME invoice. Both should route
      // (return true), but together they must produce exactly one PENDING row.
      const results = await Promise.all([routeOnce(), routeOnce()]);
      expect(results).toEqual([true, true]);

      const pending = await prisma.approvalRequest.findMany({
        where: {
          organizationId: org.orgId,
          documentType: 'INVOICE',
          documentId: invoiceId,
          status: 'PENDING',
        },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      // No GL while held.
      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('Bug B — two concurrent approves: one wins, one 409s, JE posted exactly once', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const admin = await seedUser(org.orgId, 'ADMIN', true);
      const invoiceId = await makeDraftInvoice(org.orgId);

      // Route to a single open PENDING request.
      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      const req = await prisma.approvalRequest.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          documentType: 'INVOICE',
          documentId: invoiceId,
          status: 'PENDING',
        },
        select: { id: true },
      });

      // Fire two concurrent approves on the same request.
      const settled = await Promise.allSettled([
        approveRequest(req.id, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' }),
        approveRequest(req.id, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' }),
      ]);

      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The loser is a clean conflict (409 / no-longer-pending), not a crash.
      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      const status = (rejectedReason as { status?: number })?.status;
      const message = String((rejectedReason as { message?: string })?.message ?? rejectedReason);
      expect(status === 409 || /no longer pending|not pending|pending/i.test(message)).toBe(true);

      // The finalizer ran exactly once. The org is freshly seeded and this is
      // the only document, so org-wide there must be exactly ONE journal entry.
      // (A double-post — Bug B — would yield two.)
      expect(await journalEntryCount(org.orgId)).toBe(1);

      // Invoice posted (SENT) and the ledger balances.
      const inv = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(inv.status).toBe('SENT');
      await assertTrialBalanced(org.orgId, 'concurrent approve');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('Bug C — a past APPROVED request does NOT bless a re-finalize after revert', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const admin = await seedUser(org.orgId, 'ADMIN', true);
      const invoiceId = await makeDraftInvoice(org.orgId);

      // First cycle: route + approve → invoice SENT, an APPROVED request exists.
      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      const firstReq = await prisma.approvalRequest.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          documentType: 'INVOICE',
          documentId: invoiceId,
          status: 'PENDING',
        },
        select: { id: true },
      });
      await approveRequest(firstReq.id, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      const approved = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: firstReq.id },
        select: { status: true },
      });
      expect(approved.status).toBe('APPROVED');

      // Operator reverts the (now SENT) invoice back to DRAFT and edits it.
      await prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: { status: 'DRAFT', updatedAt: new Date() },
      });

      // Re-send: routeForApproval must NOT be blessed by the stale APPROVED.
      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      expect(routed).toBe(true);

      // A NEW open PENDING request now exists (distinct from the APPROVED one).
      const pending = await prisma.approvalRequest.findMany({
        where: {
          organizationId: org.orgId,
          documentType: 'INVOICE',
          documentId: invoiceId,
          status: 'PENDING',
        },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).not.toBe(firstReq.id);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
