import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { postPosSale } from '@/lib/pos/sale-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { prisma, createTestOrg, createItem, createCustomer, cleanupOrg, disconnect,
  accountBalance, assertInventoryReconciled, assertTrialBalanced, type TestOrg } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-07-10');
type Tx = Prisma.TransactionClient;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function overlap(first: (tx: Tx) => Promise<unknown>, second: (tx: Tx) => Promise<unknown>) {
  const ready = deferred<void>(), release = deferred<void>(), pid = deferred<number>();
  const a = prisma.$transaction(async tx => { await first(tx); ready.resolve(); await release.promise; }, { timeout: 15000 });
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
    expect(blocked).toBe(true);
  } finally { release.resolve(); await settledA; if (settledB) await settledB; }
  const error = await settledA;
  if (error) throw error;
  return settledB!;
}
function batchInput(org: TestOrg, itemId: string, qty = 5, unitCost = 100) {
  return { itemId, warehouseId: org.warehouseId, batchNumber: 'SHARED-BATCH', expiryDate: new Date('2027-07-10'), qty, unitCost, date: DATE };
}
async function snapshot(orgId: string) {
  return {
    batches: await prisma.stockBatch.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
    lots: await prisma.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
    journals: await prisma.journalEntry.findMany({ where: { organizationId: orgId }, include: { lines: true }, orderBy: { id: 'asc' } }),
  };
}
async function check(org: TestOrg, qty: number, value: number) {
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } });
  expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(qty);
  expect(lots.every(lot => Number(lot.qtyBalance) >= 0)).toBe(true);
  expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value);
  await assertInventoryReconciled(org.orgId, 'opening/batch stock');
  await assertTrialBalanced(org.orgId, 'opening/batch stock');
}

describe('opening stock and batch receipts', () => {
  for (const type of ['ASSET', 'EQUITY'] as const) {
    for (const existing of [false, true]) {
      it(`missing usable ${type} account refuses ${existing ? 'an existing batch increase' : 'a new batch'} before any write`, async () => {
        const org = await createTestOrg();
        try {
          const itemId = await createItem(org.orgId, 100);
          if (existing) await prisma.$transaction(tx => receiveBatch(tx, org.orgId, batchInput(org, itemId)));
          await prisma.account.updateMany({ where: { organizationId: org.orgId, type }, data: { isActive: false } });
          const before = await snapshot(org.orgId);
          // Deliberately catch inside the transaction and allow commit: prove
          // validation happens before writes, not merely after rollback.
          const error = await prisma.$transaction(async tx => {
            try { await receiveBatch(tx, org.orgId, batchInput(org, itemId)); }
            catch (caught) { return caught; }
          });
          expect(error).toMatchObject({ status: 422, message: expect.stringContaining('Inventory Asset and Opening Balance Equity') });
          expect(await snapshot(org.orgId)).toEqual(before);
          await check(org, existing ? 5 : 0, existing ? 500 : 0);
        } finally { await cleanupOrg(org.orgId); }
      });
    }
  }

  it('zero-cost batch quantities still post without a journal or account requirement', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId);
      await prisma.account.updateMany({ where: { organizationId: org.orgId }, data: { isActive: false } });
      await prisma.$transaction(tx => receiveBatch(tx, org.orgId, batchInput(org, itemId, 5, 0)));
      expect(Number((await prisma.stockBatch.findFirstOrThrow({ where: { organizationId: org.orgId } })).qtyOnHand)).toBe(5);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
      await check(org, 5, 0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('two overlapping legitimate receipts of the same physical batch accumulate into one batch with two stock movements and journals', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      const result = await overlap(tx => receiveBatch(tx, org.orgId, batchInput(org, itemId)), tx => receiveBatch(tx, org.orgId, batchInput(org, itemId)));
      expect(result).toBeUndefined();
      const batches = await prisma.stockBatch.findMany({ where: { organizationId: org.orgId } });
      expect(batches).toHaveLength(1);
      expect(Number(batches[0].qtyOnHand)).toBe(10);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } })).toBe(2);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(2);
      expect(await accountBalance(org.orgId, org.accounts.openingBalanceEquity)).toBe(-1000);
      await check(org, 10, 1000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('simultaneous opening requests preserve existing once-only posting', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      await prisma.item.update({ where: { id: itemId }, data: { openingStock: 10 } });
      await Promise.all([1, 2].map(() => prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, itemId, DATE))));
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(1);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } })).toBe(1);
      await check(org, 10, 1000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a sale waiting for opening stock uses the committed quantity and recorded cost', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100), customerId = await createCustomer(org.orgId);
      await prisma.item.update({ where: { id: itemId }, data: { openingStock: 10 } });
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-OPENING', issueDate: DATE,
        status: 'DRAFT', subtotal: 1800, totalAmount: 1800, lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 6, price: 300, lineSubtotal: 1800 } } } });
      const result = await overlap(tx => postOpeningStockIfNeeded(tx, org.orgId, itemId, DATE), async tx => {
        await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });
        await postInvoiceSend(tx, org.orgId, invoice.id);
      });
      expect(result).toBeUndefined();
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(600);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a POS sale waiting for a batch increase sees matching physical and valued stock', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 100);
      await prisma.item.update({ where: { id: itemId }, data: { requiresBatchTracking: true } });
      await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk in' } });
      await prisma.account.create({ data: { organizationId: org.orgId, code: '2130', name: 'Output Tax Payable', type: 'LIABILITY', normalSide: 'CREDIT' } });
      const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG', name: 'Register', warehouseId: org.warehouseId } });
      const shift = await prisma.posShift.create({ data: { organizationId: org.orgId, registerId: register.id, cashierId: 'cashier', openingFloat: 0, status: 'OPEN' } });
      await prisma.$transaction(tx => receiveBatch(tx, org.orgId, batchInput(org, itemId)));
      const result = await overlap(tx => receiveBatch(tx, org.orgId, batchInput(org, itemId)), tx => postPosSale(tx, org.orgId, {
        clientSaleId: 'batch-wait', registerId: register.id, shiftId: shift.id, cashierId: 'cashier', warehouseId: org.warehouseId,
        date: DATE, lines: [{ itemId, description: 'Stock', quantity: 6, price: 300, discountPct: 0 }], tenders: [{ method: 'CASH', amount: 1800 }],
      }));
      expect(result).toBeUndefined();
      expect(Number((await prisma.stockBatch.findFirstOrThrow({ where: { organizationId: org.orgId } })).qtyOnHand)).toBe(4);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(600);
      await check(org, 4, 400);
    } finally { await cleanupOrg(org.orgId); }
  });
});
