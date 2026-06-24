/**
 * Approval-engine integration tests — exercise the REAL engine
 * (routeForApproval / approveRequest / rejectRequest) against a real Postgres
 * `<db>_test` database and assert *behavioral* invariants the mock unit tests
 * cannot reach:
 *
 *   - no GL is posted while a document is held for approval,
 *   - authorization (canApprove + self-approval policy) is enforced,
 *   - approving an invoice runs the finalizer (posts a balanced JE, status SENT),
 *   - rejecting reverts the document to DRAFT and posts nothing.
 *
 * Run with:  npm run test:int
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed (`npm run test:int:setup`).
 *
 * NOTE: approveRequest/rejectRequest open their own transaction via the shared
 * @/lib/prisma client. The setupFiles entry (setup-test-db-env.ts) rewrites
 * DATABASE_URL to the `_test` variant so that client targets the same database
 * the harness seeds.
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
import { routeForApproval, approveRequest, rejectRequest } from '../../approval/engine';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-04-10T00:00:00.000Z');

/**
 * Seed a Role (+RolePermission on AR_INVOICES) + User + UserOrganization inline.
 * The harness's createTestOrg does NOT create users/roles, so the approval-authz
 * path (which reads UserOrganization → Role → RolePermission.canApprove) needs
 * this scaffolding.
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
 * Build a DRAFT invoice that POSTs a balanced JE when sent. We deliberately keep
 * it dead simple so the AR/Sales entry balances exactly with no inventory:
 *   - one description-only line (NO itemId) → postInvoiceSend skips the COGS path,
 *   - taxAmount = 0, discountAmount = 0 → a clean AR (Dr) / Sales (Cr) pair.
 * The harness wires arControl + salesRevenue into the org's accountDefaults, so
 * postInvoiceSend resolves both accounts deterministically.
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

async function pendingRequestId(orgId: string, invoiceId: string): Promise<string> {
  const req = await prisma.approvalRequest.findFirstOrThrow({
    where: { organizationId: orgId, documentType: 'INVOICE', documentId: invoiceId, status: 'PENDING' },
    select: { id: true },
  });
  return req.id;
}

describe('approval engine: routing, authz, finalize, reject', () => {
  it('1. requirement OFF → routeForApproval returns false', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, false);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const invoiceId = await makeDraftInvoice(org.orgId);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );

      expect(routed).toBe(false);
      const requests = await prisma.approvalRequest.count({
        where: { organizationId: org.orgId, documentId: invoiceId },
      });
      expect(requests).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('2. requirement ON → returns true, no GL posted, exactly one PENDING request', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const invoiceId = await makeDraftInvoice(org.orgId);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );

      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentId: invoiceId, status: 'PENDING' },
        select: { id: true, requestedById: true },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].requestedById).toBe(submitter);

      // Invoice itself is untouched by routing — still DRAFT.
      const inv = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(inv.status).toBe('DRAFT');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('3. non-approver (canApprove=false) cannot approve → rejects /permission/i', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const approver = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const invoiceId = await makeDraftInvoice(org.orgId);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, invoiceId);

      await expect(
        approveRequest(requestId, { orgId: org.orgId, userId: approver, roleType: 'ACCOUNTANT' }),
      ).rejects.toThrow(/permission/i);

      // Nothing finalized: no GL, request still PENDING, invoice still DRAFT.
      expect(await journalEntryCount(org.orgId)).toBe(0);
      const req = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true },
      });
      expect(req.status).toBe('PENDING');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('4. self-approval blocked: accountant WITH canApprove who submitted → rejects /submitted/i', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', true);
      const invoiceId = await makeDraftInvoice(org.orgId);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, invoiceId);

      await expect(
        approveRequest(requestId, { orgId: org.orgId, userId: submitter, roleType: 'ACCOUNTANT' }),
      ).rejects.toThrow(/submitted/i);

      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('5. admin self-approval allowed → invoice SENT and ledger balanced', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const admin = await seedUser(org.orgId, 'ADMIN', true);
      const invoiceId = await makeDraftInvoice(org.orgId);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const requestId = await pendingRequestId(org.orgId, invoiceId);
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      // Finalizer ran: invoice is SENT, request APPROVED.
      const inv = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(inv.status).toBe('SENT');

      const req = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true, reviewedById: true },
      });
      expect(req.status).toBe('APPROVED');
      expect(req.reviewedById).toBe(admin);

      // A balanced GL entry was actually posted by the finalizer.
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'approval finalize');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('6. reject → invoice back to DRAFT, no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const approver = await seedUser(org.orgId, 'ADMIN', true);
      const invoiceId = await makeDraftInvoice(org.orgId);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'INVOICE',
          documentId: invoiceId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, invoiceId);

      await rejectRequest(
        requestId,
        { orgId: org.orgId, userId: approver, roleType: 'ADMIN' },
        'Insufficient backup',
      );

      const inv = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(inv.status).toBe('DRAFT');

      const req = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true, note: true },
      });
      expect(req.status).toBe('REJECTED');
      expect(req.note).toBe('Insufficient backup');

      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
