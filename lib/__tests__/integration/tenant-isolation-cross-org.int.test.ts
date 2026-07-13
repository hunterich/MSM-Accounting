/**
 * Cross-company (tenant-isolation) regression tests for the create/finalize
 * paths that accept parent foreign keys.
 *
 * These drive the REAL POST route handlers against a real Postgres `<db>_test`
 * database with TWO seeded orgs, and assert that a caller in Org A can never
 * attach — or mutate — a record owned by Org B:
 *
 *   C-4  a bill in Org A that references Org B's purchaseOrderLineId is rejected
 *        with a 4xx AND leaves Org B's PO line untouched (no receivedQty bump,
 *        no status flip). Before the fix the bill route looked the PO line up by
 *        id with no org filter, and lib/bill-po-receipt incremented it with no
 *        org filter — a cross-org write.
 *
 *   H-6  create routes that spread the payload + set `organizationId: orgId` but
 *        validate none of their parent FKs (invoice.customerId, credit/debit-note
 *        source refs, sales/purchase-return invoice/bill refs) let a caller attach
 *        another org's record, which then leaks through the GET `include` joins.
 *        Each must now reject the cross-org ref with a 4xx and create nothing.
 *
 * Run with:  npm run test:int -- tenant-isolation-cross-org
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
  createCustomer,
  createItem,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';
import { POST as createBill } from '../../../src/app/api/v1/bills/route';
import { POST as createInvoice } from '../../../src/app/api/v1/invoices/route';
import { POST as createCreditNote } from '../../../src/app/api/v1/credit-notes/route';
import { POST as createDebitNote } from '../../../src/app/api/v1/debit-notes/route';
import { POST as createSalesReturn } from '../../../src/app/api/v1/sales-returns/route';
import { POST as createPurchaseReturn } from '../../../src/app/api/v1/purchase-returns/route';

afterAll(async () => {
  await disconnect();
});

const DATE = '2026-05-12';

/**
 * Seed an ADMIN Role + User + UserOrganization so the routes' server-side RBAC
 * (withPermission) and the invoice access-context lookup have a real membership
 * to read. ADMIN bypasses the per-module permission check. Returns the userId.
 */
async function seedAdminUser(orgId: string): Promise<string> {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { email: `u-${randomUUID()}@test.local`, fullName: 'Test User', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } });
  return user.id;
}

/** Seed an APPROVED PO (one line: qty 10, receivedQty 0) in the given org. */
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
          { lineNo: 1, itemId, description: 'Widget', quantity: 10, unit: 'PCS', price: 1000, receivedQty: 0, lineTotal: 10000 },
        ],
      },
    },
    include: { lines: true },
  });
  return { poId: po.id, poLineId: po.lines[0].id };
}

function jsonRequest(url: string, orgId: string, userId: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    // x-role-type ADMIN bypasses withPermission's per-module RBAC lookup.
    headers: { 'x-org-id': orgId, 'x-user-id': userId, 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('cross-org create/finalize rejects foreign-org parent references', () => {
  it('C-4: a bill in Org A referencing Org B\'s purchaseOrderLineId is rejected and does NOT mutate Org B\'s PO line', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const vendorA = await createVendor(orgA.orgId);

      // Org B's PO line — the victim row.
      const vendorB = await createVendor(orgB.orgId);
      const itemB = await createItem(orgB.orgId);
      const { poId: poB, poLineId: poLineB } = await seedPo(orgB, vendorB, itemB);

      const res = await createBill(
        jsonRequest('http://localhost/api/v1/bills', orgA.orgId, userA, {
          vendorId: vendorA,
          issueDate: DATE,
          status: 'DRAFT',
          taxable: false,
          taxInclusive: false,
          taxRate: 0,
          lines: [
            {
              lineNo: 1,
              purchaseOrderLineId: poLineB, // <-- Org B's PO line
              description: 'Widget',
              quantity: 10,
              unit: 'PCS',
              price: 1000,
              lineTotal: 10000,
            },
          ],
        }),
      );

      // Rejected with a 4xx (not a 500, not a silent create).
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);

      // Org B's PO line + parent PO are untouched.
      const line = await prisma.purchaseOrderLine.findUniqueOrThrow({
        where: { id: poLineB },
        select: { receivedQty: true },
      });
      const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poB }, select: { status: true } });
      expect(Number(line.receivedQty)).toBe(0);
      expect(po.status).toBe('APPROVED');

      // No bill was created in Org A.
      expect(await prisma.bill.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('H-6: an invoice in Org A with Org B\'s customerId is rejected and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const customerB = await createCustomer(orgB.orgId);

      const res = await createInvoice(
        jsonRequest('http://localhost/api/v1/invoices', orgA.orgId, userA, {
          customerId: customerB, // <-- Org B's customer
          issueDate: DATE,
          lines: [{ description: 'Service', quantity: 1, price: 100, unit: 'PCS' }],
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await prisma.salesInvoice.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('H-6: an invoice in Org A with Org B\'s line itemId is rejected and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const customerA = await createCustomer(orgA.orgId);
      const itemB = await createItem(orgB.orgId); // Org B's item

      const res = await createInvoice(
        jsonRequest('http://localhost/api/v1/invoices', orgA.orgId, userA, {
          customerId: customerA,
          issueDate: DATE,
          lines: [{ itemId: itemB, description: 'Service', quantity: 1, price: 100, unit: 'PCS' }],
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await prisma.salesInvoice.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('H-6: a credit note in Org A referencing Org B\'s sourceInvoiceId is rejected and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const customerA = await createCustomer(orgA.orgId);
      // A real Org B invoice to reference cross-org.
      const customerB = await createCustomer(orgB.orgId);
      const invoiceB = await prisma.salesInvoice.create({
        data: {
          organizationId: orgB.orgId, number: `INV-${randomUUID().slice(0, 8)}`, customerId: customerB,
          issueDate: new Date(DATE), status: 'DRAFT', subtotal: 100, totalAmount: 100,
        },
        select: { id: true },
      });

      const res = await createCreditNote(
        jsonRequest('http://localhost/api/v1/credit-notes', orgA.orgId, userA, {
          customerId: customerA,
          sourceInvoiceId: invoiceB.id, // <-- Org B's invoice
          date: DATE,
          amount: 100,
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await prisma.creditNote.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('H-6: a debit note in Org A referencing Org B\'s sourceBillId is rejected and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const vendorA = await createVendor(orgA.orgId);
      const vendorB = await createVendor(orgB.orgId);
      const billB = await prisma.bill.create({
        data: {
          organizationId: orgB.orgId, number: `BILL-${randomUUID().slice(0, 8)}`, vendorId: vendorB,
          issueDate: new Date(DATE), status: 'DRAFT', totalAmount: 100,
        },
        select: { id: true },
      });

      const res = await createDebitNote(
        jsonRequest('http://localhost/api/v1/debit-notes', orgA.orgId, userA, {
          vendorId: vendorA,
          sourceBillId: billB.id, // <-- Org B's bill
          date: DATE,
          amount: 100,
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await prisma.debitNote.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('H-6: a sales return in Org A referencing Org B\'s invoiceId is rejected and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const customerA = await createCustomer(orgA.orgId);
      const customerB = await createCustomer(orgB.orgId);
      const invoiceB = await prisma.salesInvoice.create({
        data: {
          organizationId: orgB.orgId, number: `INV-${randomUUID().slice(0, 8)}`, customerId: customerB,
          issueDate: new Date(DATE), status: 'DRAFT', subtotal: 100, totalAmount: 100,
        },
        select: { id: true },
      });

      const res = await createSalesReturn(
        jsonRequest('http://localhost/api/v1/sales-returns', orgA.orgId, userA, {
          customerId: customerA,
          invoiceId: invoiceB.id, // <-- Org B's invoice
          returnDate: DATE,
          subtotal: 100, taxAmount: 0, totalAmount: 100,
          lines: [],
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await prisma.salesReturn.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('H-6: a purchase return in Org A referencing Org B\'s billId is rejected and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const userA = await seedAdminUser(orgA.orgId);
      const vendorA = await createVendor(orgA.orgId);
      const vendorB = await createVendor(orgB.orgId);
      const billB = await prisma.bill.create({
        data: {
          organizationId: orgB.orgId, number: `BILL-${randomUUID().slice(0, 8)}`, vendorId: vendorB,
          issueDate: new Date(DATE), status: 'DRAFT', totalAmount: 100,
        },
        select: { id: true },
      });

      const res = await createPurchaseReturn(
        jsonRequest('http://localhost/api/v1/purchase-returns', orgA.orgId, userA, {
          vendorId: vendorA,
          billId: billB.id, // <-- Org B's bill
          returnDate: DATE,
          subtotal: 100, taxAmount: 0, totalAmount: 100,
          lines: [],
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await prisma.purchaseReturn.count({ where: { organizationId: orgA.orgId } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });
});
