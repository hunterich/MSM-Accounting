/**
 * Phase-2 approval-engine integration tests — exercise the REAL engine
 * (routeForApproval / approveRequest / rejectRequest) against a real Postgres
 * `<db>_test` database for the NEW Phase-2 document types: BILL, CREDIT_NOTE,
 * and PAYROLL_RUN.
 *
 * These prove the same behavioral invariants the Phase-1 INVOICE suite proves,
 * per document type:
 *   - no GL is posted while a document is held for approval (route returns true),
 *   - approving runs the document's finalizer (posts a balanced JE, advances the
 *     document to its live status: BILL→OPEN, CREDIT_NOTE→APPLIED, PAYROLL→POSTED),
 *   - rejecting reverts the document to its Phase-2 revert target and posts
 *     nothing — crucially PAYROLL_RUN reverts to REVIEWED (NOT DRAFT).
 *
 * Run with:  npm run test:int -- approval-engine-phase2
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed (`npm run test:int:setup`).
 *
 * Structure mirrors approval-engine.int.test.ts (Phase 1): a per-module
 * seedUser helper (admin is used as approver — admins bypass the per-module
 * canApprove check), a setRequirement helper that writes the org's
 * approvalRequirements config key, routeForApproval inside a $transaction, then
 * approveRequest / rejectRequest against the shared engine prisma client (the
 * setup file repoints it at the `_test` DB).
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
  cleanupOrg,
  disconnect,
} from './harness';
import { routeForApproval, approveRequest, rejectRequest } from '../../approval/engine';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-04-10T00:00:00.000Z');

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
  moduleKey: 'AP_BILLS' | 'AR_CREDITS' | 'HR_PAYROLL',
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
  documentType: 'BILL' | 'CREDIT_NOTE' | 'PAYROLL_RUN',
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
 * DRAFT bill with one inventory line (no PO link). The BILL finalizer passes the
 * raw bill row (with lines included) to postBillToLedger, which books a balanced
 * Dr Inventory / Cr AP entry plus a cost layer. taxable=false keeps it to a
 * clean two-line entry. createItem makes a PRODUCT, so the line counts as
 * inventory.
 */
async function makeDraftBill(orgId: string): Promise<string> {
  const vendorId = await createVendor(orgId);
  const itemId = await createItem(orgId);
  const bill = await prisma.bill.create({
    data: {
      organizationId: orgId,
      number: `BILL-${randomUUID().slice(0, 8)}`,
      vendorId,
      issueDate: DATE,
      status: 'DRAFT',
      taxable: false,
      taxInclusive: false,
      taxRate: 0,
      subtotal: 10000,
      taxAmount: 0,
      totalAmount: 10000,
      lines: {
        create: [
          {
            lineNo: 1,
            itemId,
            description: 'Widget',
            quantity: 10,
            unit: 'PCS',
            price: 1000,
            lineTotal: 10000,
          },
        ],
      },
    },
    select: { id: true },
  });
  return bill.id;
}

/**
 * DRAFT credit note. postCreditNoteOnApply books DR Sales-Return / CR AR for the
 * gross amount (applyTax=false → no Output-Tax line, so we avoid the arTax
 * account). Wire returnAccountId + arAccountId explicitly to the seeded
 * accounts so resolution is deterministic.
 */
async function makeDraftCreditNote(orgId: string, accounts: Record<string, string>): Promise<string> {
  const customerId = await createCustomer(orgId);
  const cn = await prisma.creditNote.create({
    data: {
      organizationId: orgId,
      number: `CN-${randomUUID().slice(0, 8)}`,
      customerId,
      date: DATE,
      status: 'DRAFT',
      applyTax: false,
      amount: 25000,
      taxAmount: 0,
      // arReturn default is unseeded in the harness, so pin the accounts directly.
      returnAccountId: accounts.salesRevenue,
      arAccountId: accounts.arControl,
    },
    select: { id: true },
  });
  return cn.id;
}

/**
 * Payroll run in REVIEWED status (the pre-post state). One line, no tax / no
 * BPJS / no deductions, so gross === net. postPayrollRunToLedger then books a
 * balanced Dr Salary-Expense 100000 / Cr Cash 100000 entry:
 *   debit  = totalGross + totalBpjsEmployer = 100000 + 0
 *   credit = totalNet + totalTax + totalBpjsAll + totalDeductions = 100000 + 0
 * The expense account resolves to code 5100 (seeded as COGS); cash + tax
 * accounts resolve via the posting lib's type-based fallbacks (the required-
 * accounts guard is satisfied — an ASSET and a LIABILITY postable both exist).
 */
async function makeReviewedPayrollRun(orgId: string): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      organizationId: orgId,
      employeeNo: `EMP-${randomUUID().slice(0, 8)}`,
      name: 'Test Employee',
      joinDate: DATE,
      basicSalary: 100000,
    },
    select: { id: true },
  });
  // month/year must be unique per org; randomise within valid ranges.
  const month = 1 + Math.floor(Math.random() * 12);
  const year = 2000 + Math.floor(Math.random() * 1000);
  const run = await prisma.payrollRun.create({
    data: {
      organizationId: orgId,
      number: `PR-${randomUUID().slice(0, 8)}`,
      month,
      year,
      periodStart: new Date(Date.UTC(year, month - 1, 1)),
      periodEnd: new Date(Date.UTC(year, month - 1, 28)),
      status: 'REVIEWED',
      totalGross: 100000,
      totalDeductions: 0,
      totalTax: 0,
      totalBpjs: 0,
      totalNet: 100000,
      lines: {
        create: [
          {
            employeeId: employee.id,
            basicSalary: 100000,
            totalAllowances: 0,
            totalDeductions: 0,
            grossPay: 100000,
            totalBpjsEmployee: 0,
            totalBpjsEmployer: 0,
            pph21: 0,
            netPay: 100000,
          },
        ],
      },
    },
    select: { id: true },
  });
  return run.id;
}

/* ------------------------------------------------------------------ */
/* BILL — full GL proof                                                */
/* ------------------------------------------------------------------ */

describe('approval engine Phase 2: BILL route-hold + approve/reject', () => {
  it('requirement ON → routed, no GL, one PENDING request; approve → OPEN + balanced; (separate) reject → DRAFT', async () => {
    // --- hold + approve path ---
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ap_bills', true);
      const admin = await seedUser(org.orgId, 'ADMIN', true, 'AP_BILLS');
      const billId = await makeDraftBill(org.orgId);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'BILL',
          documentId: billId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'BILL', documentId: billId, status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      // Bill untouched by routing — still DRAFT.
      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } })).status,
      ).toBe('DRAFT');

      const requestId = pending[0].id;
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      // Finalizer ran: bill OPEN, request APPROVED, balanced JE posted.
      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } })).status,
      ).toBe('OPEN');
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('APPROVED');
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'bill approval finalize');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reject → bill back to DRAFT, no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ap_bills', true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false, 'AP_BILLS');
      const approver = await seedUser(org.orgId, 'ADMIN', true, 'AP_BILLS');
      const billId = await makeDraftBill(org.orgId);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, { orgId: org.orgId, userId: submitter, documentType: 'BILL', documentId: billId }),
      );
      const requestId = await pendingRequestId(org.orgId, 'BILL', billId);

      await rejectRequest(
        requestId,
        { orgId: org.orgId, userId: approver, roleType: 'ADMIN' },
        'Missing faktur',
      );

      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } })).status,
      ).toBe('DRAFT');
      const req = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true, note: true },
      });
      expect(req.status).toBe('REJECTED');
      expect(req.note).toBe('Missing faktur');
      expect(await journalEntryCount(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* CREDIT_NOTE — GL proof (no inventory)                               */
/* ------------------------------------------------------------------ */

describe('approval engine Phase 2: CREDIT_NOTE route-hold + approve/reject', () => {
  it('requirement ON → routed, no GL, one PENDING request; approve → APPLIED + balanced', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ar_credits', true);
      const admin = await seedUser(org.orgId, 'ADMIN', true, 'AR_CREDITS');
      const cnId = await makeDraftCreditNote(org.orgId, org.accounts);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'CREDIT_NOTE',
          documentId: cnId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'CREDIT_NOTE', documentId: cnId, status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      expect(
        (await prisma.creditNote.findUniqueOrThrow({ where: { id: cnId }, select: { status: true } })).status,
      ).toBe('DRAFT');

      const requestId = pending[0].id;
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      expect(
        (await prisma.creditNote.findUniqueOrThrow({ where: { id: cnId }, select: { status: true } })).status,
      ).toBe('APPLIED');
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('APPROVED');
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'credit note approval finalize');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reject → credit note back to DRAFT, no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'ar_credits', true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false, 'AR_CREDITS');
      const approver = await seedUser(org.orgId, 'ADMIN', true, 'AR_CREDITS');
      const cnId = await makeDraftCreditNote(org.orgId, org.accounts);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'CREDIT_NOTE',
          documentId: cnId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, 'CREDIT_NOTE', cnId);

      await rejectRequest(requestId, { orgId: org.orgId, userId: approver, roleType: 'ADMIN' });

      expect(
        (await prisma.creditNote.findUniqueOrThrow({ where: { id: cnId }, select: { status: true } })).status,
      ).toBe('DRAFT');
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
/* PAYROLL_RUN — route-hold + payroll-specific reject target + approve */
/* ------------------------------------------------------------------ */

describe('approval engine Phase 2: PAYROLL_RUN route-hold + REVIEWED-revert + approve', () => {
  it('requirement ON → routed, no GL, one PENDING request; approve → POSTED + balanced', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'hr_payroll', true);
      const admin = await seedUser(org.orgId, 'ADMIN', true, 'HR_PAYROLL');
      const runId = await makeReviewedPayrollRun(org.orgId);

      const routed = await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: admin,
          documentType: 'PAYROLL_RUN',
          documentId: runId,
        }),
      );
      expect(routed).toBe(true);
      expect(await journalEntryCount(org.orgId)).toBe(0);

      const pending = await prisma.approvalRequest.findMany({
        where: { organizationId: org.orgId, documentType: 'PAYROLL_RUN', documentId: runId, status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(1);

      // Run untouched by routing — still REVIEWED.
      expect(
        (await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } })).status,
      ).toBe('REVIEWED');

      const requestId = pending[0].id;
      await approveRequest(requestId, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });

      // Finalizer ran: run POSTED, request APPROVED, balanced JE posted.
      expect(
        (await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } })).status,
      ).toBe('POSTED');
      expect(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } }))
          .status,
      ).toBe('APPROVED');
      expect(await journalEntryCount(org.orgId)).toBeGreaterThan(0);
      await assertTrialBalanced(org.orgId, 'payroll approval finalize');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reject → payroll run reverts to REVIEWED (NOT DRAFT), no GL posted', async () => {
    const org = await createTestOrg();
    try {
      await setRequirement(org.orgId, 'hr_payroll', true);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false, 'HR_PAYROLL');
      const approver = await seedUser(org.orgId, 'ADMIN', true, 'HR_PAYROLL');
      const runId = await makeReviewedPayrollRun(org.orgId);

      await prisma.$transaction((tx) =>
        routeForApproval(tx, {
          orgId: org.orgId,
          userId: submitter,
          documentType: 'PAYROLL_RUN',
          documentId: runId,
        }),
      );
      const requestId = await pendingRequestId(org.orgId, 'PAYROLL_RUN', runId);

      await rejectRequest(requestId, { orgId: org.orgId, userId: approver, roleType: 'ADMIN' });

      // The Phase-2 payroll-specific revert target: REVIEWED, not DRAFT.
      expect(
        (await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } })).status,
      ).toBe('REVIEWED');
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
