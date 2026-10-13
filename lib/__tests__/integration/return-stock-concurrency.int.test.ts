import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { voidSalesReturn, voidPurchaseReturn } from '@/lib/return-void';
import { reverseAddedLayers } from '@/lib/inventory-costing';
import { reverseJournalEntry } from '@/lib/reverse-journal-entry';
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
// Release the completed-but-uncommitted first posting only after PostgreSQL
// reports the contender blocked. Expected amounts below do not use costing helpers.
async function overlap(first: (tx: Tx) => Promise<unknown>, second: (tx: Tx) => Promise<unknown>) {
  const ready = deferred<void>(), release = deferred<void>(), pid = deferred<number>();
  const a = prisma.$transaction(async tx => { await first(tx); ready.resolve(); await release.promise; }, { timeout: 15000 });
  const settledA = a.then(() => undefined, error => error);
  let settledB: Promise<unknown> | undefined;
  try {
    await Promise.race([ready.promise, a.then(() => { throw new Error('First posting did not wait'); })]);
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
    expect(blocked, 'contender must overlap the uncommitted posting').toBe(true);
  } finally { release.resolve(); await settledA; if (settledB) await settledB; }
  const error = await settledA;
  if (error) throw error;
  return settledB!;
}
async function stock() {
  const org = await createTestOrg();
  const itemId = await createItem(org.orgId, 100), customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'B-STOCK', issueDate: DATE, status: 'OPEN',
    subtotal: 1000, totalAmount: 1000, lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 10, price: 100, lineTotal: 1000 } } }, include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  return { org, itemId, customerId, vendorId, bill };
}
async function invoice(org: TestOrg, itemId: string, customerId: string, number: string, qty: number) {
  return prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: DATE, status: 'DRAFT',
    subtotal: qty * 300, totalAmount: qty * 300,
    lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: qty, price: 300, lineSubtotal: qty * 300 } } }, include: { lines: true } });
}
async function send(tx: Tx, org: TestOrg, id: string) {
  await tx.salesInvoice.update({ where: { id }, data: { status: 'SENT' } });
  await postInvoiceSend(tx, org.orgId, id);
}
async function returnDoc(org: TestOrg, itemId: string, customerId: string, inv: { id: string; lines: { id: string }[] }, number: string, qty: number) {
  return prisma.salesReturn.create({ data: { organizationId: org.orgId, customerId, invoiceId: inv.id, number,
    returnDate: DATE, status: 'APPROVED', lines: { create: { itemId, sourceInvoiceLineId: inv.lines[0].id,
      lineNo: 1, itemName: 'Stock', qtyReturn: qty, goodsReceived: true } } } });
}
async function returned(qty = 6) {
  const f = await stock();
  const inv = await invoice(f.org, f.itemId, f.customerId, 'INV-ORIGINAL', 10);
  await prisma.$transaction(tx => send(tx, f.org, inv.id));
  const ret = await returnDoc(f.org, f.itemId, f.customerId, inv, 'SR-ORIGINAL', qty);
  await prisma.$transaction(tx => postSalesReturnOnApproval(tx, ret.id));
  return { ...f, inv, ret };
}
async function check(org: TestOrg, qty: number, value: number, cogs: number) {
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } });
  expect(lots.every(lot => Number(lot.qtyBalance) >= 0)).toBe(true);
  expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(qty);
  expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value);
  expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(cogs);
  await assertInventoryReconciled(org.orgId, 'return contention');
  await assertTrialBalanced(org.orgId, 'return contention');
}

describe('return stock and reversals share the inventory lock order', () => {
  it('the reversal primitive cannot delete a layer checked before a concurrent sale commits', async () => {
    const { org, itemId, customerId, ret } = await returned();
    try {
      const sale = await invoice(org, itemId, customerId, 'INV-PRIMITIVE-RACE', 2);
      const before = await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id } });
      // Exercise the reusable primitive directly, independent of a caller's
      // journal lock. Without its item lock it reads the old balance, waits on
      // the sale's row update, then deletes that now-consumed lot.
      const result = await overlap(tx => send(tx, org, sale.id), async tx => {
        await tx.salesReturn.update({ where: { id: ret.id }, data: { status: 'VOID' } });
        await reverseAddedLayers(tx, org.orgId, 'SALES_RETURN', ret.id, DATE);
        await reverseJournalEntry(tx, before.journalEntryId!, { date: DATE, memo: 'Primitive reversal race' });
      });
      expect(result).toMatchObject({ status: 422, message: expect.stringContaining('consumed or sold') });
      expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('APPROVED');
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(6);
      await check(org, 4, 400, 600);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a customer-return void waiting for a sale re-reads the consumed lot and rolls back status, contra movements and GL', async () => {
    const { org, itemId, customerId, ret } = await returned();
    try {
      const sale = await invoice(org, itemId, customerId, 'INV-RESALE', 2);
      const result = await overlap(tx => send(tx, org, sale.id), tx => voidSalesReturn(tx, org.orgId, ret.id, { date: DATE }));
      expect(result).toMatchObject({ status: 422, message: expect.stringContaining('consumed or sold') });
      expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('APPROVED');
      const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: ret.id } });
      expect(Number(lot.qtyBalance)).toBe(4);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId, documentId: ret.id, documentType: 'ADJUSTMENT' } })).toBe(0);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(6);
      await check(org, 4, 400, 600);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a sale waiting for a customer-return void fails cleanly without consuming removed stock', async () => {
    const { org, itemId, customerId, ret } = await returned();
    try {
      const sale = await invoice(org, itemId, customerId, 'INV-AFTER-VOID', 2);
      const result = await overlap(tx => voidSalesReturn(tx, org.orgId, ret.id, { date: DATE }), tx => send(tx, org, sale.id));
      expect(result).toMatchObject({ status: 422, message: expect.stringContaining('Insufficient stock') });
      expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('DRAFT');
      expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('VOID');
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(5);
      await check(org, 0, 0, 1000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a replacement return waits for the old full return to be voided before checking already-returned totals', async () => {
    const { org, itemId, customerId, inv, ret } = await returned(10);
    try {
      // Persist a candidate directly; its real posting must validate after the
      // old full return releases the invoice-return lock, not against stale totals.
      const replacement = await returnDoc(org, itemId, customerId, inv, 'SR-REPLACEMENT', 10);
      const result = await overlap(tx => voidSalesReturn(tx, org.orgId, ret.id, { date: DATE }), tx => postSalesReturnOnApproval(tx, replacement.id));
      expect(result).toBeUndefined();
      const current = await prisma.salesReturn.findUniqueOrThrow({ where: { id: replacement.id }, include: { lines: true } });
      expect(current.postedAt).toBeTruthy();
      expect(Number(current.lines[0].inventoryCost)).toBe(1000);
      await check(org, 10, 1000, 0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('voiding one return waits for another return posting against the same invoice', async () => {
    const { org, itemId, customerId, inv, ret } = await returned(6);
    try {
      const next = await returnDoc(org, itemId, customerId, inv, 'SR-NEXT', 4);
      const result = await overlap(tx => postSalesReturnOnApproval(tx, next.id), tx => voidSalesReturn(tx, org.orgId, ret.id, { date: DATE }));
      expect(result).toBeUndefined();
      expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('VOID');
      expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: next.id } })).postedAt).toBeTruthy();
      await check(org, 4, 400, 600);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('simultaneous customer-return voids retain the existing one-time reversal guarantee', async () => {
    const { org, ret } = await returned(6);
    try {
      const results = await Promise.allSettled([1, 2].map(() => prisma.$transaction(tx => voidSalesReturn(tx, org.orgId, ret.id, { date: DATE }))));
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(5);
      await check(org, 0, 0, 1000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a sale waits for supplier-return restoration and uses the recorded returned cost', async () => {
    const { org, itemId, customerId, vendorId, bill } = await stock();
    try {
      const ret = await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId, billId: bill.id, number: 'PR-VOID',
        returnDate: DATE, status: 'APPROVED', returnAccountId: org.accounts.apControl,
        lines: { create: { itemId, lineNo: 1, description: 'Stock', qtyReturn: 5 } } } });
      await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, ret.id));
      const sale = await invoice(org, itemId, customerId, 'INV-AFTER-PR-VOID', 8);
      const result = await overlap(tx => voidPurchaseReturn(tx, org.orgId, ret.id, { date: DATE }), tx => send(tx, org, sale.id));
      expect(result).toBeUndefined();
      expect((await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('VOID');
      expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-1000);
      await check(org, 2, 200, 800);
    } finally { await cleanupOrg(org.orgId); }
  });
});
