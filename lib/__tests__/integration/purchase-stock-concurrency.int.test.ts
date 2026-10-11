import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { POST as receivePo } from '@/src/app/api/v1/purchase-orders/[id]/receive/route';
import { postBillToLedger } from '@/lib/bill-posting';
import { postGoodsReceiptToLedger } from '@/lib/goods-receipt-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { voidBill } from '@/lib/bill-void';
import { reverseBillPosting } from '@/lib/repost';
import { unreceiveGoodsReceipt } from '@/lib/unreceive-goods';
import { prisma, createTestOrg, createCustomer, createVendor, createItem, cleanupOrg, disconnect,
  accountBalance, assertInventoryReconciled, assertTrialBalanced, type TestOrg } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-07-10');
type Tx = Prisma.TransactionClient;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
// A real posting is held uncommitted until PostgreSQL reports the other
// transaction blocked. This forces the stock snapshot to overlap deterministically.
async function overlap(first: (tx: Tx) => Promise<unknown>, second: (tx: Tx) => Promise<unknown>) {
  const ready = deferred<void>(), release = deferred<void>(), pid = deferred<number>();
  const a = prisma.$transaction(async tx => {
    await first(tx); ready.resolve(); await release.promise;
  }, { timeout: 15000 });
  const settledA = a.then(() => undefined, error => error);
  let settledB: Promise<unknown> | undefined;
  try {
    await Promise.race([ready.promise, a.then(() => { throw new Error('Posting did not wait'); })]);
    const b = prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      pid.resolve(rows[0].pid); await second(tx);
    }, { timeout: 15000 });
    settledB = b.then(() => undefined, error => error);
    const backend = await pid.promise;
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${backend}::int)) > 0 AS blocked`;
      if (rows[0].blocked) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    expect(blocked, 'contender must wait for the uncommitted posting').toBe(true);
  } finally {
    release.resolve(); await settledA; if (settledB) await settledB;
  }
  const error = await settledA;
  if (error) throw error;
  return settledB!;
}

async function bill(org: TestOrg, itemId: string, number: string, qty: number, price: number) {
  const vendorId = await createVendor(org.orgId);
  return prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: DATE, status: 'OPEN',
    subtotal: qty * price, totalAmount: qty * price,
    lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: qty, price, lineTotal: qty * price } } }, include: { lines: true } });
}
async function sale(org: TestOrg, itemId: string, qty: number) {
  const customerId = await createCustomer(org.orgId);
  return prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-RACE', issueDate: DATE,
    status: 'DRAFT', subtotal: qty * 300, totalAmount: qty * 300,
    lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: qty, price: 300, lineSubtotal: qty * 300 } } } });
}
async function send(tx: Tx, org: TestOrg, id: string) {
  await tx.salesInvoice.update({ where: { id }, data: { status: 'SENT' } });
  await postInvoiceSend(tx, org.orgId, id);
}
async function receipt(org: TestOrg, itemId: string) {
  const vendorId = await createVendor(org.orgId);
  const po = await prisma.purchaseOrder.create({ data: { organizationId: org.orgId, vendorId, number: 'PO-RACE', date: DATE,
    status: 'PARTIAL_RECEIVED', lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 20, receivedQty: 10, price: 100, lineTotal: 2000 } } }, include: { lines: true } });
  const received = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, poId: po.id, number: 'GR-RACE', issueDate: DATE,
    status: 'DRAFT', lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 10, price: 100, lineTotal: 1000, purchaseOrderLineId: po.lines[0].id } } } });
  await prisma.$transaction(tx => postGoodsReceiptToLedger(tx, org.orgId, { billId: received.id, poNumber: po.number,
    date: DATE, taxInclusive: false, taxRate: 0, lines: [{ itemId, quantity: 10, lineTotal: 1000 }] }));
  return { po, received };
}
async function check(org: TestOrg, qty: number, value: number) {
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } });
  expect(lots.every(lot => Number(lot.qtyBalance) >= 0)).toBe(true);
  expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(qty);
  expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value);
  await assertInventoryReconciled(org.orgId, 'purchase contention');
  await assertTrialBalanced(org.orgId, 'purchase contention');
}

describe('purchase stock transaction locks', () => {
  it.each(['bill', 'goods receipt'] as const)('a sale waits for an uncommitted %s and sees its stock', async kind => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const existing = await bill(org, itemId, 'B-BASE', 5, 100);
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, existing));
      const incoming = await bill(org, itemId, 'B-INCOMING', 5, 200);
      const invoice = await sale(org, itemId, 6);
      const result = await overlap(tx => kind === 'bill' ? postBillToLedger(tx, org.orgId, incoming) : postGoodsReceiptToLedger(tx, org.orgId,
        { billId: incoming.id, poNumber: 'PO-INCOMING', date: new Date(DATE.getTime() + 1000), taxInclusive: false, taxRate: 0,
          lines: [{ itemId, quantity: 5, lineTotal: 1000 }] }), tx => send(tx, org, invoice.id));
      expect(result).toBeUndefined();
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(700);
      await check(org, 4, 800);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a bill void waiting for a sale refuses consumed stock and rolls back its claim and journals', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const posted = await bill(org, itemId, 'B-VOID', 10, 100);
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, posted));
      const invoice = await sale(org, itemId, 6);
      const result = await overlap(tx => send(tx, org, invoice.id), tx => voidBill(tx, org.orgId, posted.id, { date: DATE }));
      expect(result).toMatchObject({ status: 422, message: expect.stringContaining('consumed or sold') });
      expect(await prisma.bill.findUniqueOrThrow({ where: { id: posted.id } })).toMatchObject({ status: 'OPEN', voidedAt: null });
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(3);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a sale waiting for a bill void fails with insufficient stock and leaves its draft intact', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const posted = await bill(org, itemId, 'B-VOID-FIRST', 10, 100);
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, posted));
      const invoice = await sale(org, itemId, 3);
      const result = await overlap(tx => voidBill(tx, org.orgId, posted.id, { date: DATE }), tx => send(tx, org, invoice.id));
      expect(result).toMatchObject({ status: 422, message: expect.stringContaining('Insufficient stock') });
      expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('DRAFT');
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(2);
      await check(org, 0, 0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a bill correction restores the replacement stock atomically before a waiting sale', async () => {
    const org = await createTestOrg();
    try {
      const originalItem = await createItem(org.orgId, 100), replacementItem = await createItem(org.orgId, 100);
      const posted = await bill(org, originalItem, 'B-CORRECT', 5, 100);
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, posted));
      const invoice = await sale(org, replacementItem, 6);
      const result = await overlap(async tx => {
        const current = await tx.bill.findUniqueOrThrow({ where: { id: posted.id } });
        await reverseBillPosting(tx, org.orgId, current, { date: DATE, replacementItemIds: [replacementItem] });
        await tx.billLine.updateMany({ where: { billId: posted.id }, data: { itemId: replacementItem, quantity: 10, lineTotal: 1000 } });
        await tx.bill.update({ where: { id: posted.id }, data: { subtotal: 1000, totalAmount: 1000 } });
        const corrected = await tx.bill.findUniqueOrThrow({ where: { id: posted.id }, include: { lines: true } });
        await postBillToLedger(tx, org.orgId, corrected);
      }, tx => send(tx, org, invoice.id));
      expect(result).toBeUndefined();
      expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId, itemId: originalItem } })).toBe(0);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(600);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a failed un-receipt rolls back PO quantities, status and soft-delete as well as stock and journals', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const { po, received } = await receipt(org, itemId);
      const invoice = await sale(org, itemId, 6);
      const result = await overlap(tx => send(tx, org, invoice.id), tx => unreceiveGoodsReceipt(tx, org.orgId, received.id, { date: DATE }));
      expect(result).toMatchObject({ status: 422, message: expect.stringContaining('consumed or sold') });
      expect((await prisma.bill.findUniqueOrThrow({ where: { id: received.id } })).deletedAt).toBeNull();
      expect(Number((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).receivedQty)).toBe(10);
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PARTIAL_RECEIVED');
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(3);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('receiving and un-receiving the same PO concurrently preserves the net receipt and GR/IR', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const { po, received } = await receipt(org, itemId);
      const [response] = await Promise.all([
        receivePo(new NextRequest(`http://localhost/api/v1/purchase-orders/${po.id}/receive`, { method: 'POST',
          headers: { 'x-org-id': org.orgId, 'x-user-id': 'purchase-stock-test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
          body: JSON.stringify({ lines: [{ purchaseOrderLineId: po.lines[0].id, qtyReceived: 5 }] }) }), { params: Promise.resolve({ id: po.id }) }),
        prisma.$transaction(tx => unreceiveGoodsReceipt(tx, org.orgId, received.id, { date: DATE })),
      ]);
      expect(response.status, await response.text()).toBe(201);
      expect(Number((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).receivedQty)).toBe(5);
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PARTIAL_RECEIVED');
      expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(-500);
      await check(org, 5, 500);
    } finally { await cleanupOrg(org.orgId); }
  });
});
