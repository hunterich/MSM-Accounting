/**
 * INV-02 (#170) acceptance gaps left by po-receipt-valuation-acceptance:
 *
 *  1. The real HTTP receive route under contention. The earlier cases composed
 *     the route's steps in a helper; these call POST /purchase-orders/[id]/receive
 *     itself while a real posting holds its locks, and fan out concurrent receives.
 *  2. Inventory postings against a fiscal-year close. A year can be closed while
 *     some of its months have no period row (later years get rows only when
 *     generated), and a closed month without linked manual journals can be
 *     deleted. Inventory postings dated in such a year used to go through after
 *     the closing entry, leaving it stale. lib/period-guard.ts now refuses any
 *     posting dated inside a closed fiscal year, serialized with the close.
 *
 * Each overlap holds the first transaction until PostgreSQL reports the contender
 * waiting on a lock that transaction owns (pg_blocking_pids), so no timing
 * assumption picks the winner.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST as receivePo } from '@/src/app/api/v1/purchase-orders/[id]/receive/route';
import { POST as reopenYear } from '@/src/app/api/v1/fiscal-year/reopen/route';
import { DELETE as deletePeriod } from '@/src/app/api/v1/accounting-periods/[id]/route';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { changeInventoryCostingMethod } from '@/lib/inventory-costing-switch';
import { closeAccountingPeriod } from '@/lib/period-close';
import { closeFiscalYear } from '@/lib/fiscal-year-close';
import { accountingDay } from '@/lib/accounting-date';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect,
  accountBalance, inventoryLedgerValue, inventoryLotValue, assertTrialBalanced, type TestOrg } from './harness';

afterAll(disconnect);
type Tx = Prisma.TransactionClient;
type Settled<T> = { value?: T; error?: unknown };

/**
 * Run `hold` in a transaction and keep it open until PostgreSQL reports that the
 * contender is waiting on a lock this transaction owns, then commit it and
 * return how the contender settled.
 */
async function holdWhile<T>(hold: (tx: Tx) => Promise<unknown>, contender: () => Promise<T>): Promise<Settled<T>> {
  let ready!: (pid: number) => void, release!: () => void;
  const started = new Promise<number>(resolve => { ready = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const holder = prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await hold(tx);
    ready(row.pid);
    await held;
  }, { timeout: 20000 });
  const holderResult = holder.then(() => null, (error: unknown) => error);
  let contenderResult: Promise<Settled<T>> | undefined;
  try {
    const pid = await Promise.race([started, holder.then(() => { throw new Error('Holder finished without holding its locks'); })]);
    contenderResult = contender().then(value => ({ value }), (error: unknown) => ({ error }));
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
      if (row.waiting > 0) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked, 'the contender must wait on a lock the holder owns').toBe(true);
  } finally {
    release();
    await holderResult;
    if (contenderResult) await contenderResult;
  }
  expect(await holderResult).toBeNull();
  return contenderResult!;
}

const tx15 = <T>(work: (tx: Tx) => Promise<T>) => prisma.$transaction(work, { timeout: 15000 });

async function snapshot(orgId: string) {
  const where = { organizationId: orgId }, orderBy = { id: 'asc' as const };
  return {
    lots: await prisma.inventoryLot.findMany({ where, orderBy }),
    ledger: await prisma.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await prisma.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    bills: await prisma.bill.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    orders: await prisma.purchaseOrder.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    invoices: await prisma.salesInvoice.findMany({ where, orderBy }),
  };
}

/** Unassigned (no warehouse) stock: quantity and stored carrying value. */
async function unassignedStock(orgId: string) {
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: orgId, warehouseId: null } });
  return {
    quantity: lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0),
    value: lots.reduce((sum, lot) => sum + Number(lot.carryingValue), 0),
  };
}

/** Inventory stays the same number in the lots, the stock ledger and the GL. */
async function expectInventory(org: TestOrg, value: number) {
  expect(await inventoryLotValue(org.orgId)).toBe(value);
  expect(await inventoryLedgerValue(org.orgId)).toBe(value);
  expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value);
  await assertTrialBalanced(org.orgId);
}

async function openingBill(org: TestOrg, itemId: string, vendorId: string, date: Date) {
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: `OPEN-${randomUUID().slice(0, 8)}`, issueDate: date, status: 'OPEN',
    subtotal: 5000, totalAmount: 5000, lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price: 1000, lineTotal: 5000 } } }, include: { lines: true } });
  await tx15(tx => postBillToLedger(tx, org.orgId, bill));
  return bill;
}

async function draftSale(org: TestOrg, itemId: string, customerId: string, date: Date, quantity = 2) {
  return prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: `SALE-${randomUUID().slice(0, 8)}`, issueDate: date, status: 'DRAFT',
    subtotal: quantity * 3000, totalAmount: quantity * 3000,
    lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity, price: 3000, lineSubtotal: quantity * 3000 } } } });
}

async function send(tx: Tx, orgId: string, invoiceId: string) {
  await tx.salesInvoice.update({ where: { id: invoiceId }, data: { status: 'SENT' } });
  await postInvoiceSend(tx, orgId, invoiceId);
}

/* ------------------------------------------------------------------ */
/* 1. The HTTP receive route under contention                          */
/* ------------------------------------------------------------------ */

describe('INV-02 HTTP PO receive route under contention', () => {
  // The route stamps the receipt with the current time, so every date here is today.
  const today = () => new Date(`${accountingDay(new Date())}T00:00:00.000Z`);

  async function fixture(method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'WEIGHTED_AVERAGE') {
    const org = await createTestOrg({ costingMethod: method });
    const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
    await openingBill(org, itemId, vendorId, today());
    const po = await prisma.purchaseOrder.create({ data: { organizationId: org.orgId, vendorId, number: `PO-${randomUUID().slice(0, 8)}`, date: today(), status: 'APPROVED',
      totalAmount: 6000, lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 3, price: 2000, lineTotal: 6000 } } }, include: { lines: true } });
    const receive = (qtyReceived = 3) => receivePo(new NextRequest(`http://localhost/api/v1/purchase-orders/${po.id}/receive`, {
      method: 'POST',
      headers: { 'x-org-id': org.orgId, 'x-user-id': 'inv02-route-test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [{ purchaseOrderLineId: po.lines[0].id, qtyReceived }] }),
    }), { params: Promise.resolve({ id: po.id }) });
    const receivedQty = async () => Number((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).receivedQty);
    return { org, itemId, vendorId, customerId, po, receive, receivedQty };
  }

  it('concurrent receives of the same PO line never over-receive', async () => {
    const f = await fixture();
    try {
      // Three receives of 2 against 3 ordered: exactly one fits.
      const responses = await Promise.all([f.receive(2), f.receive(2), f.receive(2)]);
      const statuses = responses.map(response => response.status).sort();
      expect(statuses).toEqual([201, 422, 422]);
      for (const refused of responses.filter(response => response.status === 422)) {
        expect((await refused.json()).error).toMatch(/Over-receiving: only 1\.0000 units remaining/);
      }
      expect(await f.receivedQty()).toBe(2);
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: f.po.id } })).status).toBe('PARTIAL_RECEIVED');
      expect(await prisma.bill.count({ where: { organizationId: f.org.orgId, poId: f.po.id } })).toBe(1);
      expect(await unassignedStock(f.org.orgId)).toEqual({ quantity: 7, value: 9000 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.grIrClearing)).toBe(-4000);
      await expectInventory(f.org, 9000);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('a receive arriving during a sale waits, then posts after the sale at the new average', async () => {
    const f = await fixture();
    try {
      const sale = await draftSale(f.org, f.itemId, f.customerId, today());
      const result = await holdWhile(tx => send(tx, f.org.orgId, sale.id), () => f.receive());
      expect(result.value?.status).toBe(201);
      // The sale took 2 at the opening average of 1,000; 3 left at 3,000, plus 3 received at 2,000.
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(2000);
      expect(await unassignedStock(f.org.orgId)).toEqual({ quantity: 6, value: 9000 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.grIrClearing)).toBe(-6000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(6000);
      expect(await f.receivedQty()).toBe(3);
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: f.po.id } })).status).toBe('CLOSED');
      await expectInventory(f.org, 9000);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('a receive arriving during a FIFO to WA switch waits, keeps original receipts and posts no revaluation', async () => {
    const f = await fixture('FIFO');
    try {
      const original = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      const journalsBefore = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });
      const result = await holdWhile(tx => changeInventoryCostingMethod(tx, f.org.orgId, 'WEIGHTED_AVERAGE', today()), () => f.receive());
      expect(result.value?.status).toBe(201);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.orgId } })).costingMethod).toBe('WEIGHTED_AVERAGE');
      // Only the receipt's journal is new: the switch itself books nothing.
      expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(journalsBefore + 1);
      const after = await prisma.inventoryLot.findMany({ where: { id: { in: original.map(lot => lot.id) } }, orderBy: { id: 'asc' } });
      expect(after.map(({ carryingValue, initialValue, ...lot }) => lot)).toEqual(original.map(({ carryingValue, initialValue, ...lot }) => lot));
      expect(await unassignedStock(f.org.orgId)).toEqual({ quantity: 8, value: 11000 });
      await expectInventory(f.org, 11000);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('a receive arriving during the month close waits, is refused and changes nothing', async () => {
    const f = await fixture();
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@route-close.test`, fullName: 'Route close reviewer' } });
    try {
      const day = today();
      const period = await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: 'Current month',
        startDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)),
        endDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1) - 1), status: 'OPEN' } });
      const before = await snapshot(f.org.orgId);
      const result = await holdWhile(tx => closeAccountingPeriod(tx, f.org.orgId, user.id, period.id), () => f.receive());
      expect(result.value?.status).toBe(422);
      expect((await result.value!.json()).error).toMatch(/closed\/locked/);
      expect(await snapshot(f.org.orgId)).toEqual(before);
      expect(await f.receivedQty()).toBe(0);
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: f.po.id } })).status).toBe('APPROVED');
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('CLOSED');
      await expectInventory(f.org, 5000);
    } finally { await cleanupOrg(f.org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
  });
});

/* ------------------------------------------------------------------ */
/* 2. Inventory postings against a fiscal-year close                   */
/* ------------------------------------------------------------------ */

describe('INV-02 inventory postings against a fiscal-year close', () => {
  const YEAR_START = new Date('2025-01-01');
  const LATE_2025 = new Date('2025-11-20');

  /** FY2025 with no period rows: 5 bought at 1,000 in March, 2 sold at 3,000 in June. */
  async function fixture() {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE', fiscalYearStart: YEAR_START });
    const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@year-close.test`, fullName: 'Year close reviewer' } });
    await openingBill(org, itemId, vendorId, new Date('2025-03-01'));
    const june = await draftSale(org, itemId, customerId, new Date('2025-06-10'));
    await tx15(tx => send(tx, org.orgId, june.id));
    const headers = { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
    const closeYear = (tx: Tx) => closeFiscalYear(tx, org.orgId, YEAR_START, user.id);
    const cleanup = async () => { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); };
    return { org, itemId, customerId, user, headers, closeYear, cleanup };
  }

  /** P&L for the year nets to zero once the closing entry posts; RE holds the profit. */
  async function expectClosed(org: TestOrg, profit: number) {
    expect(await accountBalance(org.orgId, org.accounts.salesRevenue)).toBe(0);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0);
    expect(await accountBalance(org.orgId, org.accounts.retainedEarnings)).toBe(-profit);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId, source: 'CLOSING' } })).toBe(1);
  }

  const closedYear = /Fiscal year 2025-01-01 to 2025-12-31 is closed — cannot post on 2025-/;
  const writers: Array<{ name: string; post: (f: Awaited<ReturnType<typeof fixture>>) => Promise<(tx: Tx) => Promise<unknown>> }> = [
    { name: 'sale', post: async f => { const sale = await draftSale(f.org, f.itemId, f.customerId, LATE_2025); return tx => send(tx, f.org.orgId, sale.id); } },
    { name: 'stock adjustment', post: async f => tx => postStockAdjustmentToLedger(tx, f.org.orgId, {
      id: `ADJ-${randomUUID().slice(0, 8)}`, number: 'ADJ-LATE', date: LATE_2025, warehouseId: f.org.warehouseId,
      lines: [{ itemId: f.itemId, oldQty: 0, newQty: 1, unitCost: 1500 }] }) },
  ];

  it('refuses inventory postings dated in a closed year that has no period rows, and accepts them again after reopening', async () => {
    const f = await fixture();
    try {
      await tx15(f.closeYear);
      await expectClosed(f.org, 4000);
      for (const writer of writers) {
        const before = await snapshot(f.org.orgId);
        const post = await writer.post(f);
        await expect(tx15(post), writer.name).rejects.toMatchObject({ status: 422, message: expect.stringMatching(closedYear) });
        const { invoices: invoicesBefore, ...booksBefore } = before;
        const { invoices: invoicesAfter, ...booksAfter } = await snapshot(f.org.orgId);
        expect(booksAfter, writer.name).toEqual(booksBefore);
        expect(invoicesAfter.filter(invoice => invoice.status === 'SENT')).toEqual(invoicesBefore.filter(invoice => invoice.status === 'SENT'));
      }
      await expectClosed(f.org, 4000);
      expect(await unassignedStock(f.org.orgId)).toEqual({ quantity: 3, value: 3000 });
      await expectInventory(f.org, 3000);

      // The next year stays open.
      const january = await draftSale(f.org, f.itemId, f.customerId, new Date('2026-01-05'), 1);
      await tx15(tx => send(tx, f.org.orgId, january.id));
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(1000);

      // Reopening the year lifts the refusal.
      const reopened = await reopenYear(new NextRequest('http://localhost/api/v1/fiscal-year/reopen', { method: 'POST', headers: f.headers, body: '{}' }));
      expect(reopened.status, await reopened.clone().text()).toBe(200);
      const late = await draftSale(f.org, f.itemId, f.customerId, LATE_2025, 1);
      await tx15(tx => send(tx, f.org.orgId, late.id));
      expect(await unassignedStock(f.org.orgId)).toEqual({ quantity: 1, value: 1000 });
      await expectInventory(f.org, 1000);
    } finally { await f.cleanup(); }
  });

  it('refuses inventory postings in a closed year after one of its closed months is deleted', async () => {
    const f = await fixture();
    try {
      let november = '';
      for (let month = 0; month < 12; month++) {
        const period = await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: `2025-${month + 1}`,
          startDate: new Date(Date.UTC(2025, month, 1)), endDate: new Date(Date.UTC(2025, month + 1, 1) - 1), status: 'CLOSED', isLocked: true } });
        if (month === 10) november = period.id;
      }
      await tx15(f.closeYear);
      // No manual journal is linked to the month, so the route allows the delete.
      const deleted = await deletePeriod(new NextRequest(`http://localhost/api/v1/accounting-periods/${november}`, { method: 'DELETE', headers: f.headers }),
        { params: Promise.resolve({ id: november }) });
      expect(deleted.status, await deleted.clone().text()).toBe(200);
      const before = await snapshot(f.org.orgId);
      const post = await writers[0].post(f);
      await expect(tx15(post)).rejects.toMatchObject({ status: 422, message: expect.stringMatching(closedYear) });
      const { invoices: _a, ...booksBefore } = before;
      const { invoices: _b, ...booksAfter } = await snapshot(f.org.orgId);
      expect(booksAfter).toEqual(booksBefore);
      await expectClosed(f.org, 4000);
      await expectInventory(f.org, 3000);
    } finally { await f.cleanup(); }
  });

  for (const writer of writers) {
    it(`year close wins against a ${writer.name}: the posting waits, is refused and the closing entry stays complete`, async () => {
      const f = await fixture();
      try {
        const post = await writer.post(f);
        const before = await snapshot(f.org.orgId);
        const result = await holdWhile(f.closeYear, () => tx15(post));
        expect(result.error).toMatchObject({ status: 422, message: expect.stringMatching(closedYear) });
        const { journals: _j, invoices: _i, ...booksBefore } = before;
        const { journals, invoices: _k, ...booksAfter } = await snapshot(f.org.orgId);
        expect(booksAfter).toEqual(booksBefore);
        // Only the closing entry was added.
        expect(journals.map(journal => journal.source)).toEqual([...before.journals.map(journal => journal.source), 'CLOSING']);
        await expectClosed(f.org, 4000);
        await expectInventory(f.org, 3000);
      } finally { await f.cleanup(); }
    });
  }

  it('a sale in flight wins against the year close: the close waits and includes the sale', async () => {
    const f = await fixture();
    try {
      const post = await writers[0].post(f);
      const result = await holdWhile(post, () => tx15(f.closeYear));
      expect(result.error).toBeUndefined();
      // Two sales of 2 at 3,000 and cost 1,000: revenue 12,000, COGS 4,000.
      await expectClosed(f.org, 8000);
      const closing = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, source: 'CLOSING' }, include: { lines: true } });
      const line = (accountId: string) => closing.lines.find(l => l.accountId === accountId);
      expect(Number(line(f.org.accounts.salesRevenue)?.debit)).toBe(12000);
      expect(Number(line(f.org.accounts.cogsExpense)?.credit)).toBe(4000);
      expect(await unassignedStock(f.org.orgId)).toEqual({ quantity: 1, value: 1000 });
      await expectInventory(f.org, 1000);
    } finally { await f.cleanup(); }
  });
});
