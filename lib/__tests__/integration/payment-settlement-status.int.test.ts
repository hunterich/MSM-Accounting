/**
 * Payments roll up into the invoice / bill status, against a real database.
 *
 * Outstanding amounts were always derived from allocations, but nothing wrote
 * PAID back to the document, so a settled invoice stayed "Sent" and a paid bill
 * stayed "Unpaid" with live Pay / Void buttons. These cover the transitions the
 * routes, the approval finalizer and the void path all share:
 *
 *   partial receipt  → still open
 *   full receipt     → PAID
 *   void the receipt → back to open (SENT / OPEN)
 *
 * and, as a by-product of the same receipt, that the dashboard's cash figure
 * now comes from the ledger (the bank register's cached balance never moved).
 *
 * Run with:  npm run test:int -- payment-settlement-status
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ledgerCashOnHand } from '@/lib/cash-accounts';
import { postApPaymentIfNeeded, postArPaymentIfNeeded } from '@/lib/payment-posting';
import { voidApPayment, voidArPayment } from '@/lib/payment-void';
import {
  syncApPaymentSettlement,
  syncArPaymentSettlement,
  syncBillSettlementStatus,
  syncInvoiceSettlementStatus,
} from '@/lib/settlement-status';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-07-10T00:00:00.000Z');
let seq = 0;
const nextNo = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

async function createSentInvoice(org: TestOrg, customerId: string, total: number) {
  return prisma.salesInvoice.create({
    data: {
      organizationId: org.orgId,
      number: nextNo('INV'),
      customerId,
      issueDate: DATE,
      dueDate: DATE,
      status: 'SENT',
      subtotal: total,
      taxAmount: 0,
      totalAmount: total,
    },
    select: { id: true },
  });
}

async function createOpenBill(org: TestOrg, vendorId: string, total: number) {
  return prisma.bill.create({
    data: {
      organizationId: org.orgId,
      number: nextNo('BILL'),
      vendorId,
      issueDate: DATE,
      dueDate: DATE,
      status: 'OPEN',
      subtotal: total,
      taxAmount: 0,
      totalAmount: total,
    },
    select: { id: true },
  });
}

/** A COMPLETED receipt applied to one invoice, posted the way the route posts it. */
async function receive(org: TestOrg, customerId: string, invoiceId: string, amount: number) {
  const payment = await prisma.aRPayment.create({
    data: {
      organizationId: org.orgId,
      number: nextNo('ARP'),
      customerId,
      date: DATE,
      status: 'COMPLETED',
      totalAmount: amount,
      allocations: { create: [{ invoiceId, amountApplied: amount }] },
    },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await postArPaymentIfNeeded(tx, org.orgId, payment.id);
    await syncArPaymentSettlement(tx, org.orgId, payment.id);
  });
  return payment.id;
}

async function pay(org: TestOrg, vendorId: string, billId: string, amount: number) {
  const payment = await prisma.aPPayment.create({
    data: {
      organizationId: org.orgId,
      number: nextNo('APP'),
      vendorId,
      date: DATE,
      status: 'COMPLETED',
      totalAmount: amount,
      allocations: { create: [{ billId, amountApplied: amount }] },
    },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await postApPaymentIfNeeded(tx, org.orgId, payment.id);
    await syncApPaymentSettlement(tx, org.orgId, payment.id);
  });
  return payment.id;
}

const invoiceStatus = async (id: string) =>
  (await prisma.salesInvoice.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const billStatus = async (id: string) =>
  (await prisma.bill.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

describe('AR receipt → invoice status', () => {
  it('partial → SENT, full → PAID, void → SENT again; cash on hand follows the ledger', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      const invoice = await createSentInvoice(org, customerId, 1_000_000);
      expect(await ledgerCashOnHand(prisma, org.orgId)).toBe(0);

      await receive(org, customerId, invoice.id, 400_000);
      expect(await invoiceStatus(invoice.id)).toBe('SENT');
      expect(await ledgerCashOnHand(prisma, org.orgId)).toBe(400_000);

      const rest = await receive(org, customerId, invoice.id, 600_000);
      expect(await invoiceStatus(invoice.id)).toBe('PAID');
      expect(await ledgerCashOnHand(prisma, org.orgId)).toBe(1_000_000);

      await prisma.$transaction((tx) => voidArPayment(tx, org.orgId, rest, { date: DATE }));
      expect(await invoiceStatus(invoice.id)).toBe('SENT');
      expect(await ledgerCashOnHand(prisma, org.orgId)).toBe(400_000);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('a cash discount settles the invoice alongside the cash applied', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      const invoice = await createSentInvoice(org, customerId, 100_000);
      await prisma.aRPayment.create({
        data: {
          organizationId: org.orgId,
          number: nextNo('ARP'),
          customerId,
          date: DATE,
          status: 'COMPLETED',
          totalAmount: 98_000,
          allocations: { create: [{ invoiceId: invoice.id, amountApplied: 98_000, discountAmount: 2_000 }] },
        },
      });
      await prisma.$transaction((tx) => syncInvoiceSettlementStatus(tx, org.orgId, invoice.id));
      expect(await invoiceStatus(invoice.id)).toBe('PAID');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('ignores allocations of DRAFT and PENDING_APPROVAL receipts, and never touches a DRAFT invoice', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      const invoice = await createSentInvoice(org, customerId, 50_000);
      for (const status of ['DRAFT', 'PENDING_APPROVAL'] as const) {
        await prisma.aRPayment.create({
          data: {
            organizationId: org.orgId,
            number: nextNo('ARP'),
            customerId,
            date: DATE,
            status,
            totalAmount: 50_000,
            allocations: { create: [{ invoiceId: invoice.id, amountApplied: 50_000 }] },
          },
        });
      }
      await prisma.$transaction((tx) => syncInvoiceSettlementStatus(tx, org.orgId, invoice.id));
      expect(await invoiceStatus(invoice.id)).toBe('SENT');

      const draft = await prisma.salesInvoice.create({
        data: { organizationId: org.orgId, number: nextNo('INV'), customerId, issueDate: DATE, status: 'DRAFT', totalAmount: 0 },
        select: { id: true },
      });
      await prisma.$transaction((tx) => syncInvoiceSettlementStatus(tx, org.orgId, draft.id));
      expect(await invoiceStatus(draft.id)).toBe('DRAFT');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

describe('AP payment → bill status', () => {
  it('partial → OPEN, full → PAID, void → OPEN again', async () => {
    const org = await createTestOrg();
    try {
      const vendorId = await createVendor(org.orgId);
      const bill = await createOpenBill(org, vendorId, 300_000);

      await pay(org, vendorId, bill.id, 100_000);
      expect(await billStatus(bill.id)).toBe('OPEN');

      const rest = await pay(org, vendorId, bill.id, 200_000);
      expect(await billStatus(bill.id)).toBe('PAID');

      await prisma.$transaction((tx) => voidApPayment(tx, org.orgId, rest, { date: DATE }));
      expect(await billStatus(bill.id)).toBe('OPEN');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('is a no-op for a bill that does not belong to the org', async () => {
    const org = await createTestOrg();
    const other = await createTestOrg();
    try {
      const vendorId = await createVendor(other.orgId);
      const bill = await createOpenBill(other, vendorId, 10);
      await prisma.$transaction((tx) => syncBillSettlementStatus(tx, org.orgId, bill.id));
      expect(await billStatus(bill.id)).toBe('OPEN');
    } finally {
      await cleanupOrg(org.orgId);
      await cleanupOrg(other.orgId);
    }
  });
});
