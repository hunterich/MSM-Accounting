import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { POST as createAdjustment } from '@/src/app/api/v1/stock-adjustments/route';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { voidStockAdjustment } from '@/lib/stock-adjustment-void';
import { postStockCount } from '@/lib/stock-count-posting';
import { reverseInvoicePosting } from '@/lib/repost';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { lockInventoryItems } from '@/lib/inventory-costing';
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

// Hold a real completed posting uncommitted, and release it only once the
// contender is blocked in PostgreSQL. No timing-dependent "simultaneous" start.
async function overlap<A, B>(first: (tx: Tx) => Promise<A>, second: (tx: Tx) => Promise<B>) {
  const ready = deferred<void>();
  const release = deferred<void>();
  const pid = deferred<number>();
  const a = prisma.$transaction(async tx => {
    const value = await first(tx);
    ready.resolve();
    await release.promise;
    return value;
  }, { timeout: 15000 });
  // Attach rejection handlers immediately so a failure cannot leak a transaction.
  const aResult = a.then(value => ({ value }), error => ({ error }));
  let bResult: Promise<{ value: B } | { error: unknown }> | undefined;
  try {
    await Promise.race([ready.promise, a.then(() => { throw new Error('First posting did not wait'); })]);
    const b = prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      pid.resolve(rows[0].pid);
      return second(tx);
    }, { timeout: 15000 });
    bResult = b.then(value => ({ value }), error => ({ error }));
    const backendPid = await pid.promise;
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT cardinality(pg_blocking_pids(${backendPid}::int)) > 0 AS blocked`;
      if (rows[0].blocked) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    expect(blocked, 'contender must overlap the uncommitted posting').toBe(true);
  } finally {
    release.resolve();
    await aResult;
    if (bResult) await bResult;
  }
  const resultA = await aResult;
  if ('error' in resultA) throw resultA.error;
  const resultB = await bResult!;
  return resultB;
}

async function receive(org: TestOrg, itemId: string, index: number, price: number) {
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: `B-${index}-${itemId}`,
    issueDate: new Date(DATE.getTime() + index * 1000), status: 'OPEN', subtotal: 5 * price, totalAmount: 5 * price } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, { id: bill.id, number: bill.number, issueDate: bill.issueDate,
    apAccountId: null, taxable: false, taxInclusive: false, taxRate: 0,
    lines: [{ id: `line-${index}`, itemId, quantity: 5, price, lineTotal: 5 * price, purchaseOrderLineId: null }] }));
  return bill;
}
async function invoice(org: TestOrg, items: string[], quantity: number) {
  const customerId = await createCustomer(org.orgId);
  return prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-RACE', issueDate: DATE,
    status: 'DRAFT', subtotal: items.length * quantity * 300, totalAmount: items.length * quantity * 300,
    lines: { create: items.map((itemId, i) => ({ itemId, lineNo: i + 1, description: 'Race item', quantity, price: 300, lineSubtotal: quantity * 300 })) } } });
}
async function send(tx: Tx, org: TestOrg, id: string) {
  await tx.salesInvoice.update({ where: { id }, data: { status: 'SENT' } });
  await postInvoiceSend(tx, org.orgId, id);
}
async function adjustment(org: TestOrg, number: string) {
  return prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number, date: DATE, status: 'APPROVED', reason: 'Concurrency regression' } });
}
function adjust(tx: Tx, org: TestOrg, adj: { id: string; number: string }, items: string[], delta: number) {
  return postStockAdjustmentToLedger(tx, org.orgId, { ...adj, date: DATE, warehouseId: null,
    lines: items.map(itemId => ({ itemId, oldQty: 0, newQty: delta, qtyDiff: delta, unitCost: 100 })) });
}
async function check(org: TestOrg, quantity: number, value: number) {
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } });
  expect(lots.every(lot => Number(lot.qtyBalance) >= 0)).toBe(true);
  expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(quantity);
  expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value);
  await assertInventoryReconciled(org.orgId, 'after inventory contention');
  await assertTrialBalanced(org.orgId, 'after inventory contention');
}

describe('stock adjustments share inventory transaction locks', () => {
  it('direct creation cannot hold adjustment numbering while a stock count holds the item', async () => {
    const org = await createTestOrg();
    const ready = deferred<number>();
    const release = deferred<void>();
    let countResult: Promise<unknown> | undefined;
    let requestResult: Promise<Response> | undefined;
    try {
      const itemId = await createItem(org.orgId, 100);
      const count = await prisma.stockCount.create({ data: { organizationId: org.orgId, number: 'SC-NUMBER', date: DATE,
        status: 'SUBMITTED', lines: { create: { lineNo: 1, itemId, systemQty: 0, countedQty: 5, unitCost: 100 } } }, include: { lines: true } });
      countResult = prisma.$transaction(async tx => {
        await lockInventoryItems(tx, org.orgId, [itemId]);
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        ready.resolve(rows[0].pid);
        await release.promise;
        const id = await postStockCount(tx, org.orgId, count);
        await tx.stockCount.update({ where: { id: count.id }, data: { status: 'POSTED', generatedAdjustmentId: id } });
      }, { timeout: 15000 });
      const settledCount = countResult.then(() => undefined, error => error);
      const blockerPid = await ready.promise;
      requestResult = createAdjustment(new NextRequest('http://localhost/api/v1/stock-adjustments', {
        method: 'POST', headers: { 'x-org-id': org.orgId, 'x-user-id': 'stock-lock-test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
        body: JSON.stringify({ date: '2026-07-10', type: 'QUANTITY', reason: 'Concurrent count', status: 'APPROVED',
          lines: [{ itemId, oldQty: 0, newQty: 2, qtyDiff: 2, unitCost: 100 }] }),
      }));
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blockerPid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (rows[0].blocked) { blocked = true; break; }
        await new Promise(done => setTimeout(done, 10));
      }
      expect(blocked).toBe(true);
      release.resolve();
      expect(await settledCount).toBeUndefined();
      const response = await requestResult;
      expect(response.status, await response.text()).toBe(201);
      const adjustments = await prisma.stockAdjustment.findMany({ where: { organizationId: org.orgId } });
      expect(adjustments).toHaveLength(2);
      expect(new Set(adjustments.map(adj => adj.number)).size).toBe(2);
      await check(org, 7, 700);
    } finally {
      release.resolve();
      await Promise.allSettled([countResult, requestResult].filter(Boolean));
      await cleanupOrg(org.orgId);
    }
  });

  it('a decrease waiting for a sale re-reads the remaining FIFO layers', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      await receive(org, itemId, 1, 100); await receive(org, itemId, 2, 200);
      const sale = await invoice(org, [itemId], 6);
      const adj = await adjustment(org, 'ADJ-AFTER-SALE');
      const result = await overlap(tx => send(tx, org, sale.id), tx => adjust(tx, org, adj, [itemId], -3));
      expect(result).not.toHaveProperty('error');
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(700);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBe(600);
      await check(org, 1, 200);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a second adjustment consumes current layers rather than a stale FIFO snapshot', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      await receive(org, itemId, 1, 100); await receive(org, itemId, 2, 200);
      const first = await adjustment(org, 'ADJ-FIRST'); const second = await adjustment(org, 'ADJ-SECOND');
      const result = await overlap(tx => adjust(tx, org, first, [itemId], -5), tx => adjust(tx, org, second, [itemId], -5));
      expect(result).not.toHaveProperty('error');
      expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBe(1500);
      await check(org, 0, 0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a count waiting for a sale computes its variance from the committed live quantity', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      await receive(org, itemId, 1, 100); await receive(org, itemId, 2, 200);
      const sale = await invoice(org, [itemId], 6);
      const count = await prisma.stockCount.create({ data: { organizationId: org.orgId, number: 'SC-RACE', date: DATE,
        status: 'SUBMITTED', lines: { create: { lineNo: 1, itemId, systemQty: 10, countedQty: 5, unitCost: 100 } } }, include: { lines: true } });
      const result = await overlap(tx => send(tx, org, sale.id), async tx => {
        await tx.stockCount.update({ where: { id: count.id }, data: { status: 'POSTED' } });
        const id = await postStockCount(tx, org.orgId, count);
        await tx.stockCount.update({ where: { id: count.id }, data: { generatedAdjustmentId: id } });
        return id;
      });
      expect(result).not.toHaveProperty('error');
      const line = await prisma.stockAdjustmentLine.findFirstOrThrow({ where: { stockAdjustment: { organizationId: org.orgId } } });
      expect(Number(line.oldQty)).toBe(4); expect(Number(line.qtyDiff)).toBe(1);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBe(-100);
      await check(org, 5, 900);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a sale waiting for an increase to be voided fails cleanly without any posting', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const adj = await adjustment(org, 'ADJ-INCREASE');
      await prisma.$transaction(tx => adjust(tx, org, adj, [itemId], 10));
      const sale = await invoice(org, [itemId], 3);
      const result = await overlap(tx => voidStockAdjustment(tx, org.orgId, adj.id, { date: DATE }), tx => send(tx, org, sale.id));
      expect(result).toHaveProperty('error');
      if ('error' in result) expect(result.error).toMatchObject({ status: 422, message: expect.stringContaining('Insufficient stock') });
      expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('DRAFT');
      expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).status).toBe('VOID');
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(2);
      await check(org, 0, 0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a void waiting for a sale refuses consumed increase layers and rolls back its status', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const adj = await adjustment(org, 'ADJ-CONSUMED');
      await prisma.$transaction(tx => adjust(tx, org, adj, [itemId], 10));
      const sale = await invoice(org, [itemId], 6);
      const result = await overlap(tx => send(tx, org, sale.id), tx => voidStockAdjustment(tx, org.orgId, adj.id, { date: DATE }));
      expect(result).toHaveProperty('error');
      if ('error' in result) expect(result.error).toMatchObject({ status: 422, message: expect.stringContaining('already been consumed') });
      expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).status).toBe('APPROVED');
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(3);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('opposite-order adjustment, purchase return and invoice correction finish without a lock cycle', async () => {
    const org = await createTestOrg();
    try {
      const items = [await createItem(org.orgId, 100), await createItem(org.orgId, 100)];
      const bills = [];
      for (const item of items) bills.push(await receive(org, item, 1, 100));
      const sale = await invoice(org, items, 2);
      await prisma.$transaction(tx => send(tx, org, sale.id));
      const adj = await adjustment(org, 'ADJ-MULTI');
      const returned = await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId: bills[0].vendorId,
        billId: bills[0].id, number: 'PR-MULTI', returnDate: DATE, status: 'APPROVED', returnAccountId: org.accounts.apControl,
        lines: { create: items.map((itemId, i) => ({ itemId, lineNo: i + 1, description: 'Return', qtyReturn: 1 })) } } });
      await Promise.all([
        prisma.$transaction(tx => adjust(tx, org, adj, [...items].reverse(), -1)),
        prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, returned.id)),
        prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${sale.id} FOR UPDATE`;
          const current = await tx.salesInvoice.findUniqueOrThrow({ where: { id: sale.id } });
          await reverseInvoicePosting(tx, org.orgId, current, { date: DATE });
          await tx.salesInvoiceLine.updateMany({ where: { invoiceId: sale.id }, data: { quantity: 1, lineSubtotal: 300 } });
          await tx.salesInvoice.update({ where: { id: sale.id }, data: { subtotal: 600, totalAmount: 600 } });
          await postInvoiceSend(tx, org.orgId, sale.id);
        }),
      ]);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(200);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBe(200);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });
});
