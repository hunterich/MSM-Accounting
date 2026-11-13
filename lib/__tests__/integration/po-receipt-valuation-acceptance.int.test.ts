import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { postGoodsReceiptToLedger } from '@/lib/goods-receipt-posting';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { changeInventoryCostingMethod } from '@/lib/inventory-costing-switch';
import { closeAccountingPeriod } from '@/lib/period-close';
import { assertPeriodOpen } from '@/lib/period-guard';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue, inventoryLotValue, assertTrialBalanced } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-09-10');
type Tx = Prisma.TransactionClient;
async function fixture(method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'WEIGHTED_AVERAGE') {
  const org = await createTestOrg({ costingMethod: method });
  const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'ORIGINAL', issueDate: new Date('2026-09-01'), status: 'OPEN', totalAmount: 5000,
    lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price: 1000, lineTotal: 5000 } } }, include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: 'OTHER-WAREHOUSE', number: 'OTHER-WAREHOUSE', date: new Date('2026-09-02'), warehouseId: org.warehouseId,
    lines: [{ itemId, oldQty: 0, newQty: 2, unitCost: 9000 }] }));
  const po = await prisma.purchaseOrder.create({ data: { organizationId: org.orgId, vendorId, number: 'INCOMING', date: DATE, status: 'APPROVED', totalAmount: 6000,
    lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 3, price: 2000, lineTotal: 6000 } } }, include: { lines: true } });
  const receipt = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, poId: po.id, number: 'RECEIPT', issueDate: DATE, status: 'DRAFT', totalAmount: 6000,
    lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 3, price: 2000, lineTotal: 6000, purchaseOrderLineId: po.lines[0].id } } }, include: { lines: true } });
  // Compose the same period guard + progress + posting transaction as the receive route.
  const receive = async (tx: Tx) => {
    await assertPeriodOpen(tx, org.orgId, DATE);
    await tx.purchaseOrderLine.update({ where: { id: po.lines[0].id }, data: { receivedQty: 3 } });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
    await postGoodsReceiptToLedger(tx, org.orgId, { billId: receipt.id, poNumber: po.number, date: DATE, taxInclusive: false, taxRate: 0, lines: receipt.lines });
  };
  const books = async (quantity: number, value: number, cogs: number, grir: number) => {
    const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } });
    const unassigned = lots.filter(lot => lot.warehouseId === null), other = lots.filter(lot => lot.warehouseId === org.warehouseId);
    expect(unassigned.reduce((s, lot) => s + Number(lot.qtyBalance), 0)).toBe(quantity);
    expect(unassigned.reduce((s, lot) => s + Number(lot.carryingValue), 0)).toBe(value);
    expect(other.map(lot => [Number(lot.qtyBalance), Number(lot.carryingValue)])).toEqual([[2, 18000]]);
    expect(await inventoryLedgerValue(org.orgId)).toBe(value + 18000);
    expect(await inventoryLotValue(org.orgId)).toBe(value + 18000);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value + 18000);
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-5000);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(cogs);
    expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(grir);
    await assertTrialBalanced(org.orgId);
  };
  return { org, itemId, vendorId, customerId, bill, po, receipt, receive, books };
}
async function snapshot(orgId: string) {
  const where = { organizationId: orgId }, orderBy = { id: 'asc' as const };
  return {
    lots: await prisma.inventoryLot.findMany({ where, orderBy }),
    ledger: await prisma.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await prisma.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    receipts: await prisma.bill.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    orders: await prisma.purchaseOrder.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    settlements: await prisma.inventoryShortfallSettlement.findMany({ where, orderBy }),
    organization: await prisma.organization.findUnique({ where: { id: orgId } }),
  };
}
// Force each order and verify a real server lock wait; no scheduler-based races.
async function overlap(firstAction: (tx: Tx) => Promise<unknown>, secondAction: (tx: Tx) => Promise<unknown>) {
  let ready!: () => void, release!: () => void, identify!: (pid: number) => void;
  const started = new Promise<void>(r => { ready = r; }), held = new Promise<void>(r => { release = r; });
  const identified = new Promise<number>(r => { identify = r; });
  const first = prisma.$transaction(async tx => { await firstAction(tx); ready(); await held; }, { timeout: 15000 });
  const firstResult = first.then(() => null, error => error);
  let secondResult: Promise<unknown> | undefined;
  try {
    await Promise.race([started, first.then(() => { throw Error('Winner failed to hold locks'); })]);
    secondResult = prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      identify(row.pid); await secondAction(tx);
    }, { timeout: 15000 }).then(() => null, error => error);
    const pid = await identified, deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
      if (row.blocked) { blocked = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    expect(blocked).toBe(true);
  } finally { release(); await firstResult; await secondResult; }
  expect(await firstResult).toBeNull();
  return await secondResult;
}

describe('INV-02 PO receipt acceptance across valuation and close locks', () => {
  for (const receiptFirst of [true, false]) for (const sale of [true, false]) {
    it(`PO receipt versus ${sale ? 'sale' : 'supplier return'}: ${receiptFirst ? 'receipt' : 'outbound'} wins without borrowing another warehouse`, async () => {
      const f = await fixture();
      try {
        const outbound = sale ? await prisma.salesInvoice.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, number: 'SALE', issueDate: DATE, status: 'DRAFT', totalAmount: 6000, subtotal: 6000,
          lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', quantity: 2, price: 3000, lineSubtotal: 6000 } } } })
          : await prisma.purchaseReturn.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId, billId: f.bill.id, number: 'RETURN', returnDate: DATE, status: 'APPROVED', returnAccountId: f.org.accounts.grIrClearing,
            lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', qtyReturn: 2 } } } });
        const consume = async (tx: Tx) => {
          if (sale) { await tx.salesInvoice.update({ where: { id: outbound.id }, data: { status: 'SENT' } }); await postInvoiceSend(tx, f.org.orgId, outbound.id); }
          else await postPurchaseReturnOnApproval(tx, outbound.id);
        };
        expect(await overlap(receiptFirst ? f.receive : consume, receiptFirst ? consume : f.receive)).toBeNull();
        const cost = receiptFirst ? 2750 : 2000;
        await f.books(6, 11000 - cost, sale ? cost : 0, sale ? -6000 : -6000 + cost);
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(sale ? 6000 : 0);
        const originals = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId, documentId: f.bill.id } });
        expect(originals.map(lot => Number(lot.unitCost))).toEqual([1000]);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }
  for (const receiptFirst of [true, false]) it(`PO receipt versus FIFO to WA: ${receiptFirst ? 'receipt' : 'method change'} wins, original receipts and all value survive`, async () => {
    const f = await fixture('FIFO');
    try {
      const original = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      const journalsBefore = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });
      const change = (tx: Tx) => changeInventoryCostingMethod(tx, f.org.orgId, 'WEIGHTED_AVERAGE', DATE);
      expect(await overlap(receiptFirst ? f.receive : change, receiptFirst ? change : f.receive)).toBeNull();
      await f.books(8, 11000, 0, -6000);
      expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(journalsBefore + 1);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.orgId } })).costingMethod).toBe('WEIGHTED_AVERAGE');
      const after = await prisma.inventoryLot.findMany({ where: { id: { in: original.map(lot => lot.id) } }, orderBy: { id: 'asc' } });
      expect(after.map(({ carryingValue, initialValue, ...lot }) => lot)).toEqual(original.map(({ carryingValue, initialValue, ...lot }) => lot));
    } finally { await cleanupOrg(f.org.orgId); }
  });
  for (const closeFirst of [true, false]) it(`PO receipt versus month close: ${closeFirst ? 'close' : 'receipt'} wins; refused receipt rolls back PO progress and stock`, async () => {
    const f = await fixture();
    const user = await prisma.user.create({ data: { email: `${f.org.orgId}@close.test`, fullName: 'Inventory close reviewer' } });
    try {
      const period = await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: 'September', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30T23:59:59.999Z'), status: 'OPEN' } });
      const before = await snapshot(f.org.orgId);
      const close = (tx: Tx) => closeAccountingPeriod(tx, f.org.orgId, user.id, period.id);
      const result = await overlap(closeFirst ? close : f.receive, closeFirst ? f.receive : close);
      if (closeFirst) {
        expect(result).toMatchObject({ status: 422 });
        expect(await snapshot(f.org.orgId)).toEqual(before);
        await f.books(5, 5000, 0, 0);
      } else {
        expect(result).toBeNull(); await f.books(8, 11000, 0, -6000);
      }
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('CLOSED');
    } finally { await cleanupOrg(f.org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
  });
});
