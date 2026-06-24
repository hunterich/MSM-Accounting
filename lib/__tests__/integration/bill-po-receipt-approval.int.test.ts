/**
 * Integration tests for the bill -> PO receipt / approval-gate invariant.
 *
 * Invariant under test: a bill pulled from a PO must apply its PO receipt
 * (increment PurchaseOrderLine.receivedQty + flip the PO to
 * PARTIAL_RECEIVED/CLOSED) EXACTLY ONCE, when the bill is FINALIZED to OPEN —
 * whether finalized directly (approval off) or via approval (held -> approved).
 * It must NOT happen while the bill is held (PENDING_APPROVAL), and must NOT
 * happen if the bill is rejected.
 *
 * Before the fix, the POST /bills route incremented receivedQty + flipped the
 * PO status UNCONDITIONALLY at create time, before the approval gate — so a bill
 * held for approval (or later rejected) left the PO showing received/closed even
 * though nothing was finalized (test 2 below). And the BILL approval finalizer
 * did NOT apply the receipt, so an approved held bill never updated the PO
 * either (test 3 below).
 *
 * These tests drive the REAL POST /bills route handler against a real
 * Postgres `<db>_test` database, plus the REAL approval engine
 * (approveRequest / rejectRequest), so they exercise the production code path
 * end-to-end.
 *
 * Run with:  npm run test:int -- bill-po-receipt-approval
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed (`npm run test:int:setup`).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  prisma,
  createTestOrg,
  createVendor,
  createItem,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';
import { POST as createBill } from '../../../src/app/api/v1/bills/route';
import { approveRequest, rejectRequest } from '../../approval/engine';

afterAll(async () => {
  await disconnect();
});

const DATE = '2026-05-12';

/**
 * Seed a Role (+RolePermission on AP_BILLS) + User + UserOrganization so the
 * approval-authz path (UserOrganization -> Role -> RolePermission.canApprove)
 * has something to read. Admins bypass the canApprove lookup, so the approver in
 * the approve/reject paths is always ADMIN.
 */
async function seedUser(orgId: string, roleType: 'ADMIN' | 'ACCOUNTANT', canApprove: boolean): Promise<string> {
  const role = await prisma.role.create({
    data: {
      organizationId: orgId,
      name: `${roleType}-AP_BILLS-${randomUUID()}`,
      roleType,
      permissions: {
        create: [{ moduleKey: 'AP_BILLS', canView: true, canCreate: true, canEdit: true, canApprove }],
      },
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { email: `u-${randomUUID()}@test.local`, fullName: 'Test User', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } });
  return user.id;
}

async function setApBillsApproval(orgId: string, on: boolean): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { approvalRequirements: { ap_bills: on } },
  });
}

/** Seed an APPROVED PO with one line: qty 10, receivedQty 0. */
async function seedPo(org: TestOrg, vendorId: string, itemId: string) {
  const po = await prisma.purchaseOrder.create({
    data: {
      organizationId: org.orgId,
      number: `PO-${randomUUID().slice(0, 8)}`,
      vendorId,
      date: new Date(DATE),
      status: 'APPROVED',
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
            receivedQty: 0,
            lineTotal: 10000,
          },
        ],
      },
    },
    include: { lines: true },
  });
  return { poId: po.id, poLineId: po.lines[0].id };
}

/** Build a bill payload (one line, qty 10) linked to the given PO line. */
function billBody(opts: { vendorId: string; itemId: string; poId: string; poLineId: string; status: string }) {
  return {
    vendorId: opts.vendorId,
    poId: opts.poId,
    issueDate: DATE,
    status: opts.status,
    vendorInvoiceNo: `INV-${randomUUID().slice(0, 8)}`,
    taxable: false,
    taxInclusive: false,
    taxRate: 0,
    lines: [
      {
        lineNo: 1,
        itemId: opts.itemId,
        purchaseOrderLineId: opts.poLineId,
        description: 'Widget',
        quantity: 10,
        unit: 'PCS',
        price: 1000,
        lineTotal: 10000,
      },
    ],
  };
}

function billRequest(orgId: string, userId: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/bills', {
    method: 'POST',
    headers: { 'x-org-id': orgId, 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readPo(poId: string, poLineId: string) {
  const [line, po] = await Promise.all([
    prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLineId }, select: { receivedQty: true } }),
    prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { status: true } }),
  ]);
  return { receivedQty: Number(line.receivedQty), poStatus: po.status };
}

describe('bill -> PO receipt applies exactly once at finalize, never while held', () => {
  it('approval OFF: create bill OPEN from PO -> receivedQty=10, PO CLOSED', async () => {
    const org = await createTestOrg();
    try {
      const vendorId = await createVendor(org.orgId);
      const itemId = await createItem(org.orgId);
      const { poId, poLineId } = await seedPo(org, vendorId, itemId);
      const userId = await seedUser(org.orgId, 'ADMIN', true);
      // approval OFF (default)

      const res = await createBill(
        billRequest(org.orgId, userId, billBody({ vendorId, itemId, poId, poLineId, status: 'OPEN' })),
      );
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.status).toBe('OPEN');

      const { receivedQty, poStatus } = await readPo(poId, poLineId);
      expect(receivedQty).toBe(10);
      expect(poStatus).toBe('CLOSED');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('approval ON: create bill OPEN -> held PENDING_APPROVAL, receivedQty=0, PO UNCHANGED', async () => {
    const org = await createTestOrg();
    try {
      await setApBillsApproval(org.orgId, true);
      const vendorId = await createVendor(org.orgId);
      const itemId = await createItem(org.orgId);
      const { poId, poLineId } = await seedPo(org, vendorId, itemId);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);

      const res = await createBill(
        billRequest(org.orgId, submitter, billBody({ vendorId, itemId, poId, poLineId, status: 'OPEN' })),
      );
      expect(res.status).toBe(201);
      const created = await res.json();
      // Held for approval.
      expect(created.status).toBe('PENDING_APPROVAL');

      // The PO receipt must NOT have happened while held.
      const { receivedQty, poStatus } = await readPo(poId, poLineId);
      expect(receivedQty).toBe(0);
      expect(poStatus).toBe('APPROVED');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('approval ON, held -> approved: receivedQty=10, PO CLOSED (applied once on approval)', async () => {
    const org = await createTestOrg();
    try {
      await setApBillsApproval(org.orgId, true);
      const vendorId = await createVendor(org.orgId);
      const itemId = await createItem(org.orgId);
      const { poId, poLineId } = await seedPo(org, vendorId, itemId);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const approver = await seedUser(org.orgId, 'ADMIN', true);

      const res = await createBill(
        billRequest(org.orgId, submitter, billBody({ vendorId, itemId, poId, poLineId, status: 'OPEN' })),
      );
      const created = await res.json();
      expect(created.status).toBe('PENDING_APPROVAL');

      // Still untouched while pending.
      expect((await readPo(poId, poLineId)).receivedQty).toBe(0);

      const req = await prisma.approvalRequest.findFirstOrThrow({
        where: { organizationId: org.orgId, documentType: 'BILL', documentId: created.id, status: 'PENDING' },
        select: { id: true },
      });
      await approveRequest(req.id, { orgId: org.orgId, userId: approver, roleType: 'ADMIN' });

      // Bill finalized to OPEN, PO receipt applied exactly once.
      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: created.id }, select: { status: true } })).status,
      ).toBe('OPEN');
      const { receivedQty, poStatus } = await readPo(poId, poLineId);
      expect(receivedQty).toBe(10);
      expect(poStatus).toBe('CLOSED');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('approval ON, held -> rejected: receivedQty=0, PO UNCHANGED, bill DRAFT', async () => {
    const org = await createTestOrg();
    try {
      await setApBillsApproval(org.orgId, true);
      const vendorId = await createVendor(org.orgId);
      const itemId = await createItem(org.orgId);
      const { poId, poLineId } = await seedPo(org, vendorId, itemId);
      const submitter = await seedUser(org.orgId, 'ACCOUNTANT', false);
      const approver = await seedUser(org.orgId, 'ADMIN', true);

      const res = await createBill(
        billRequest(org.orgId, submitter, billBody({ vendorId, itemId, poId, poLineId, status: 'OPEN' })),
      );
      const created = await res.json();
      expect(created.status).toBe('PENDING_APPROVAL');

      const req = await prisma.approvalRequest.findFirstOrThrow({
        where: { organizationId: org.orgId, documentType: 'BILL', documentId: created.id, status: 'PENDING' },
        select: { id: true },
      });
      await rejectRequest(req.id, { orgId: org.orgId, userId: approver, roleType: 'ADMIN' }, 'Wrong PO');

      // Rejected: bill back to DRAFT, PO never touched.
      expect(
        (await prisma.bill.findUniqueOrThrow({ where: { id: created.id }, select: { status: true } })).status,
      ).toBe('DRAFT');
      const { receivedQty, poStatus } = await readPo(poId, poLineId);
      expect(receivedQty).toBe(0);
      expect(poStatus).toBe('APPROVED');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
