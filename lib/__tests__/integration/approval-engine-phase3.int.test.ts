/**
 * Phase-3 approval-engine integration tests — exercise the REAL engine
 * (routeForApproval / approveRequest / rejectRequest) against a real Postgres
 * `<db>_test` database for the FINAL three Phase-3 document types: AR_PAYMENT,
 * AP_PAYMENT, and STOCK_ADJUSTMENT.
 *
 * These prove the same behavioral invariants the Phase-1 / Phase-2 suites prove,
 * per document type:
 *   - no GL is posted while a document is held for approval (route returns true),
 *   - approving runs the document's finalizer (posts a balanced JE, advances the
 *     document to its live status: AR_PAYMENT→COMPLETED, AP_PAYMENT→COMPLETED,
 *     STOCK_ADJUSTMENT→APPROVED),
 *   - rejecting reverts the document to DRAFT and posts nothing.
 *
 * Run with:  npm run test:int -- approval-engine-phase3
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed (`npm run test:int:setup`).
 *
 * Structure mirrors approval-engine.int.test.ts (Phase 1) and
 * approval-engine-phase2.int.test.ts: a per-module seedUser helper (admin is
 * used as approver — admins bypass the per-module canApprove check), a
 * setRequirement helper that writes the org's approvalRequirements config key,
 * routeForApproval inside a $transaction, then approveRequest / rejectRequest
 * against the shared engine prisma client (the setup file repoints it at the
 * `_test` DB).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  createTestOrg,
  createVendor,
  createCustomer,
  createItem,
  assertTrialBalanced,
  journalEntryCount,
  inventoryLotValue,
  cleanupOrg,
  disconnect,
} from './harness';
import { routeForApproval, approveRequest, rejectRequest } from '../../approval/engine';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-05-10T00:00:00.000Z');

type Phase3DocType = 'AR_PAYMENT' | 'AP_PAYMENT' | 'STOCK_ADJUSTMENT';
type Phase3ModuleKey = 'AR_PAYMENTS' | 'AP_PAYMENTS' | 'INV_ADJ';

/**
 * Seed a Role (+RolePermission on `moduleKey`) + User + UserOrganization inline.
 * createTestOrg does NOT create users/roles, so the approval-authz path (which
 * reads UserOrganization → Role → RolePermission.canApprove) needs scaffolding.
 * We pass the document's own moduleKey so the canApprove flag is read off the
 * right permission row — though every approver here is ADMIN, which bypasses
 * the canApprove lookup entirely.
 */
async function seedUser(
  orgId: string,
  roleType: 'ADMIN' | 'ACCOUNTANT',
  canApprove: boolean,
  moduleKey: Phase3ModuleKey,
): Promise<string> {
  const role = await prisma.role.create({
    data: {
      organizationId: orgId,
      name: `${roleType}-${moduleKey}-${randomUUID()}`,
      roleType,
      permissions: {
        create: [
          { moduleKey, canView: true, canCreate: true, canEdit: true, canApprove },
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

async function setRequirement(orgId: string, configKey: string, on: boolean): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { approvalRequirements: { [configKey]: on } },
  });
}

async function pendingRequestId(
  orgId: string,
  documentType: Phase3DocType,
  documentId: string,
): Promise<string> {
  const req = await prisma.approvalRequest.findFirstOrThrow({
    where: { organizationId: orgId, documentType, documentId, status: 'PENDING' },
    select: { id: true },
  });
  return req.id;
}

/* ------------------------------------------------------------------ */
/* Document factories                                                  */
/* ------------------------------------------------------------------ */

/**
 * DRAFT AR receipt. The AR_PAYMENT finalizer flips status to COMPLETED, then
 * postArPaymentIfNeeded books DR Bank / CR AR for totalAmount. We pin
 * depositAccountId + arAccountId to the seeded accounts so resolution is
 * deterministic and does not rely on org accountDefaults keyword matching.
 */
async function makeDraftArPayment(orgId: string, accounts: Record<string, string>): Promise<string> {
  const customerId = await createCustomer(orgId);
  const payment = await prisma.aRPayment.create({
    data: {
      organizationId: orgId,
      number: `ARP-${randomUUID().slice(0, 8)}`,
      customerId,
      date: DATE,
      status: 'DRAFT',
      totalAmount: 50000,
      depositAccountId: accounts.bankAsset,
      arAccountId: accounts.arControl,
    },
    select: { id: true },
  });
  return payment.id;
}

/**
 * DRAFT AP disbursement. The AP_PAYMENT finalizer flips status to COMPLETED,
 * then postApPaymentIfNeeded books DR AP / CR Bank for totalAmount. The posting
 * lib reads `apAccountId` and `cashAccountId` (NOT bankAccountId) for AP, so we
 * pin those two to the seeded accounts.
 */
async function makeDraftApPayment(orgId: string, accounts: Record<string, string>): Promise<string> {
  const vendorId = await createVendor(orgId);
  const payment = await prisma.aPPayment.create({
    data: {
      organizationId: orgId,
      number: `APP-${randomUUID().slice(0, 8)}`,
      vendorId,
      date: DATE,
      status: 'DRAFT',
      totalAmount: 30000,
      apAccountId: accounts.apControl,
      cashAccountId: accounts.bankAsset,
    },
    select: { id: true },
  });
  return payment.id;
}

/**
 * DRAFT stock adjustment with one increase line (oldQty 0 → newQty 10,
 * qtyDiff 10 @ unitCost 1000). The STOCK_ADJUSTMENT finalizer posts the ledger
 * + cost layer (DR Inventory 10000 / CR Variance 10000) then marks the
 * adjustment APPROVED. warehouseId is org-level metadata.
 */
async function makeDraftStockAdjustment(orgId: string, warehouseId: string): Promise<string> {
  const itemId = await createItem(orgId);
  const adj = await prisma.stockAdjustment.create({
    data: {
      organizationId: orgId,
      number: `ADJ-${randomUUID().slice(0, 8)}`,
      date: DATE,
      type: 'QUANTITY',
      reason: 'Cycle count surplus',
      status: 'DRAFT',
      warehouseId,
      lines: {
        create: [
          {
            lineNo: 1,
            itemId,
            oldQty: 0,
            newQty: 10,
            qtyDiff: 10,
            unitCost: 1000,
            totalValue: 10000,
          },
        ],
      },
    },
    select: { id: true },
  });
  return adj.id;
}

/* ------------------------------------------------------------------ */
/* AR_PAYMENT — full GL proof                                          */
/* ------------------------------------------------------------------ */

describe('approval engine Phase 3: AR_PAYMENT route-hold + approve/reject', () => {
  it('requirement ON → routed, no GL, one PENDING request; approve → COMPLETED + balanced', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ar_payments', true);
      const admin = await seedUser(org.orgId, 'ADMIN', true, 'AR_PAYMENTS');
      const paymentId = await makeDraftArPayment(org.orgId, org.accounts);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'AR_PAYMENT',
          documentId: paymentId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'AR_PAYMENT', documentId: paymentId, status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      // Payment untouched by routing — still DRAFT.
      expect(
        (await prisma.aRPayment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })).status,
      ).toBe('DRAFT');

      const requestId = pending[0].id;
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      // Finalizer ran: payment COMPLETED, request APPROVED, balanced JE posted.
      const after = await prisma.aRPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true, journalEntryId: true },
      });
      expect(after.status).toBe('COMPLETED');
      expect(after.journalEntryId).toBeTruthy();
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('APPROVED');
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'ar payment approval finalize');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reject → AR payment back to DRAFT, no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ar_payments', true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false, 'AR_PAYMENTS');
      const approver = await seedUser(org.orgId, 'ADMIN', true, 'AR_PAYMENTS');
      const paymentId = await makeDraftArPayment(org.orgId, org.accounts);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'AR_PAYMENT',
          documentId: paymentId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, 'AR_PAYMENT', paymentId);

      await rejectRequest(
        requestId,
        { orgId: org.orgId, userId: approver, roleType: 'ADMIN' },
        'Unconfirmed deposit',
      );

      const after = await prisma.aRPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true, journalEntryId: true },
      });
      expect(after.status).toBe('DRAFT');
      expect(after.journalEntryId).toBeNull();
      const req = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true, note: true },
      });
      expect(req.status).toBe('REJECTED');
      expect(req.note).toBe('Unconfirmed deposit');
      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* AP_PAYMENT — full GL proof                                          */
/* ------------------------------------------------------------------ */

describe('approval engine Phase 3: AP_PAYMENT route-hold + approve/reject', () => {
  it('requirement ON → routed, no GL, one PENDING request; approve → COMPLETED + balanced', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ap_payments', true);
      const admin = await seedUser(org.orgId, 'ADMIN', true, 'AP_PAYMENTS');
      const paymentId = await makeDraftApPayment(org.orgId, org.accounts);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'AP_PAYMENT',
          documentId: paymentId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'AP_PAYMENT', documentId: paymentId, status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      // Payment untouched by routing — still DRAFT.
      expect(
        (await prisma.aPPayment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })).status,
      ).toBe('DRAFT');

      const requestId = pending[0].id;
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      // Finalizer ran: payment COMPLETED, request APPROVED, balanced JE posted.
      const after = await prisma.aPPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true, journalEntryId: true },
      });
      expect(after.status).toBe('COMPLETED');
      expect(after.journalEntryId).toBeTruthy();
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('APPROVED');
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'ap payment approval finalize');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reject → AP payment back to DRAFT, no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ap_payments', true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false, 'AP_PAYMENTS');
      const approver = await seedUser(org.orgId, 'ADMIN', true, 'AP_PAYMENTS');
      const paymentId = await makeDraftApPayment(org.orgId, org.accounts);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'AP_PAYMENT',
          documentId: paymentId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, 'AP_PAYMENT', paymentId);

      await rejectRequest(
        requestId,
        { orgId: org.orgId, userId: approver, roleType: 'ADMIN' },
        'Awaiting vendor invoice',
      );

      const after = await prisma.aPPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true, journalEntryId: true },
      });
      expect(after.status).toBe('DRAFT');
      expect(after.journalEntryId).toBeNull();
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('REJECTED');
      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* STOCK_ADJUSTMENT — GL proof + cost-layer creation                   */
/* ------------------------------------------------------------------ */

describe('approval engine Phase 3: STOCK_ADJUSTMENT route-hold + approve/reject', () => {
  it('requirement ON → routed, no GL, one PENDING request; approve → APPROVED + balanced + cost layer', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'inv_adj', true);
      const admin = await seedUser(org.orgId, 'ADMIN', true, 'INV_ADJ');
      const adjId = await makeDraftStockAdjustment(org.orgId, org.warehouseId);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'STOCK_ADJUSTMENT',
          documentId: adjId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'STOCK_ADJUSTMENT', documentId: adjId, status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      // Adjustment untouched by routing — still DRAFT.
      expect(
        (await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adjId }, select: { status: true } })).status,
      ).toBe('DRAFT');

      const requestId = pending[0].id;
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      // Finalizer ran: adjustment APPROVED, request APPROVED, balanced JE posted.
      expect(
        (await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adjId }, select: { status: true } })).status,
      ).toBe('APPROVED');
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('APPROVED');
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'stock adjustment approval finalize');
      // The increase created an open cost layer worth 10 @ 1000.
      expect(await inventoryLotValue(org.orgId)).toBeCloseTo(10000, 2);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reject → stock adjustment back to DRAFT, no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'inv_adj', true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false, 'INV_ADJ');
      const approver = await seedUser(org.orgId, 'ADMIN', true, 'INV_ADJ');
      const adjId = await makeDraftStockAdjustment(org.orgId, org.warehouseId);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'STOCK_ADJUSTMENT',
          documentId: adjId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, 'STOCK_ADJUSTMENT', adjId);

      await rejectRequest(
        requestId,
        { orgId: org.orgId, userId: approver, roleType: 'ADMIN' },
        'Recount required',
      );

      expect(
        (await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adjId }, select: { status: true } })).status,
      ).toBe('DRAFT');
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('REJECTED');
      expect(await journalEntryCount(org.orgId)).toBe(0);
      // Nothing was posted, so no cost layer was created.
      expect(await inventoryLotValue(org.orgId)).toBeCloseTo(0, 2);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
