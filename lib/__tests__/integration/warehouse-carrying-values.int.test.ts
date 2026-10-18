import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postBillToLedger } from '@/lib/bill-posting';
import { voidInvoice } from '@/lib/invoice-void';
import { changeInventoryCostingMethod } from '@/lib/inventory-costing-switch';
import { reverseAddedLayers } from '@/lib/inventory-costing';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { voidSalesReturn, voidPurchaseReturn } from '@/lib/return-void';
import { prisma, createTestOrg, createItem, createCustomer, cleanupOrg, disconnect,
  inventoryLedgerValue, inventoryLotValue, accountBalance, assertTrialBalanced, createVendor } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-09-10');
async function fixture(method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'WEIGHTED_AVERAGE') {
  const org = await createTestOrg({ costingMethod: method }), itemId = await createItem(org.orgId, 999), customerId = await createCustomer(org.orgId);
  const b = await prisma.warehouse.create({ data: { organizationId: org.orgId, code: 'B', name: 'Warehouse B' } });
  return { org, itemId, customerId, a: org.warehouseId, b: b.id };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function receive(f: F, warehouseId: string | null, qty: number, price: number, number: string, day = 1) {
  await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, { id: number, number, date: new Date(`2026-09-0${day}`), warehouseId,
    lines: [{ itemId: f.itemId, oldQty: 0, newQty: qty, unitCost: price }] }));
}
async function invoice(f: F, quantity: number, number = 'SALE') {
  return prisma.salesInvoice.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, number, issueDate: DATE,
    status: 'DRAFT', subtotal: quantity * 3000, totalAmount: quantity * 3000,
    lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', quantity, price: 3000, lineSubtotal: quantity * 3000 } } } });
}
async function send(tx: Prisma.TransactionClient, f: F, id: string, warehouseId?: string) {
  await tx.salesInvoice.update({ where: { id }, data: { status: 'SENT' } });
  await postInvoiceSend(tx, f.org.orgId, id, { warehouseId });
}
async function pool(f: F, warehouseId: string | null) {
  const ledger = await prisma.inventoryLedgerEntry.aggregate({ where: { organizationId: f.org.orgId, itemId: f.itemId, warehouseId },
    _sum: { qtyIn: true, qtyOut: true, valueChange: true } });
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId, itemId: f.itemId, warehouseId } });
  expect(lots.every(lot => lot.carryingValue != null)).toBe(true);
  return { quantity: Number(ledger._sum.qtyIn) - Number(ledger._sum.qtyOut), value: Number(ledger._sum.valueChange),
    lotQuantity: lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0), lotValue: lots.reduce((sum, lot) => sum + Number(lot.carryingValue), 0) };
}
async function stockSnapshot(tx: Prisma.TransactionClient, orgId: string) {
  const where = { organizationId: orgId }, orderBy = { id: 'asc' as const };
  return { lots: await tx.inventoryLot.findMany({ where, orderBy }),
    ledger: await tx.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await tx.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    invoices: await tx.salesInvoice.findMany({ where, orderBy }),
    returns: await tx.salesReturn.findMany({ where, orderBy }),
    bills: await tx.bill.findMany({ where, orderBy }),
    purchaseReturns: await tx.purchaseReturn.findMany({ where, orderBy }),
  };
}
async function lockedPair(firstAction: (tx: Prisma.TransactionClient) => Promise<void>, secondAction: (tx: Prisma.TransactionClient) => Promise<void>) {
  let ready!: () => void, release!: () => void, identify!: (pid: number) => void;
  const started = new Promise<void>(done => { ready = done; }), hold = new Promise<void>(done => { release = done; });
  const identified = new Promise<number>(done => { identify = done; });
  const first = prisma.$transaction(async tx => { await firstAction(tx); ready(); await hold; }, { timeout: 15000 });
  const firstResult = first.then(() => null, error => error);
  let secondResult: Promise<unknown> | undefined;
  try {
    await Promise.race([started, first.then(() => { throw new Error('First transaction did not hold its locks'); })]);
    secondResult = prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      identify(row.pid); await secondAction(tx);
    }, { timeout: 15000 }).then(() => null, error => error);
    const pid = await identified, deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
      if (row.blocked) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    expect(blocked).toBe(true);
  } finally { release(); await firstResult; await secondResult; }
  expect(await firstResult).toBeNull(); expect(await secondResult).toBeNull();
}

describe('warehouse book value, carrying lots and source identity', () => {
  for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) it(`${method}: unassigned adjustment and supplier-return guard never borrow warehouse stock`, async () => {
    const f = await fixture(method);
    try {
      await receive(f, f.b, 2, 9000, 'OLDER-WAREHOUSE');
      const vendorId = await createVendor(f.org.orgId);
      const bill = await prisma.bill.create({ data: { organizationId: f.org.orgId, vendorId, number: 'UNASSIGNED', issueDate: DATE, status: 'OPEN', totalAmount: 3000,
        lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', quantity: 3, price: 1000, lineTotal: 3000 } } }, include: { lines: true } });
      await prisma.$transaction(tx => postBillToLedger(tx, f.org.orgId, bill));
      await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, {
        id: 'COUNT', number: 'COUNT', date: DATE, warehouseId: null,
        lines: [{ itemId: f.itemId, oldQty: 3, newQty: 1, unitCost: 9999 }],
      }));
      expect(await pool(f, null)).toEqual({ quantity: 1, lotQuantity: 1, value: 1000, lotValue: 1000 });
      expect(await pool(f, f.b)).toEqual({ quantity: 2, lotQuantity: 2, value: 18000, lotValue: 18000 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(19000);
      const ret = await prisma.purchaseReturn.create({ data: { organizationId: f.org.orgId, vendorId, number: 'TOO-MUCH', billId: bill.id,
        returnDate: DATE, status: 'APPROVED', warehouseId: null, returnAccountId: f.org.accounts.grIrClearing,
        lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', qtyReturn: 2 } } } });
      const before = await prisma.$transaction(tx => stockSnapshot(tx, f.org.orgId));
      await expect(prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, ret.id))).rejects.toThrow('available 1');
      expect(await prisma.$transaction(tx => stockSnapshot(tx, f.org.orgId))).toEqual(before);
      expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-3000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.grIrClearing)).toBe(0);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  for (const voiding of [false, true]) for (const returnFirst of [true, false]) {
    it(`supplier-return ${voiding ? 'void' : 'posting'} versus direct bill receipt: ${returnFirst ? 'return' : 'receipt'} wins`, async () => {
      const f = await fixture();
      try {
        // Direct stock bills book into the unassigned warehouse pool.
        // A separate physical warehouse must not leak its 9,000 unit cost.
        await receive(f, f.b, 2, 9000, 'OTHER');
        const vendorId = await createVendor(f.org.orgId);
        const bill = async (number: string, quantity: number, price: number) => prisma.bill.create({ data: {
          organizationId: f.org.orgId, vendorId, number, issueDate: DATE, status: 'OPEN', totalAmount: quantity * price,
          lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', quantity, price, lineTotal: quantity * price } },
        }, include: { lines: true } });
        const original = await bill('ORIGINAL', 5, 1000);
        await prisma.$transaction(tx => postBillToLedger(tx, f.org.orgId, original));
        const originalLot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: original.id } });
        const ret = await prisma.purchaseReturn.create({ data: { organizationId: f.org.orgId, vendorId, number: 'SUPPLIER-RACE', billId: original.id,
          returnDate: DATE, status: 'APPROVED', warehouseId: null, returnAccountId: f.org.accounts.grIrClearing,
          lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', qtyReturn: 2 } } } });
        if (voiding) await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, ret.id));
        const incoming = await bill('INCOMING', 3, 2000);
        const returnAction = (tx: Prisma.TransactionClient) => voiding
          ? voidPurchaseReturn(tx, f.org.orgId, ret.id, { date: DATE })
          : postPurchaseReturnOnApproval(tx, ret.id);
        const receiptAction = (tx: Prisma.TransactionClient) => postBillToLedger(tx, f.org.orgId, incoming);
        await lockedPair(returnFirst ? returnAction : receiptAction, returnFirst ? receiptAction : returnAction);
        const removed = returnFirst ? 2000 : 2750;
        const value = voiding ? 11000 : 11000 - removed, quantity = voiding ? 8 : 6;
        expect(await pool(f, null)).toEqual({ quantity, lotQuantity: quantity, value, lotValue: value });
        expect(await pool(f, f.b)).toEqual({ quantity: 2, lotQuantity: 2, value: 18000, lotValue: 18000 });
        expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(value + 18000);
        expect(await accountBalance(f.org.orgId, f.org.accounts.grIrClearing)).toBe(voiding ? 0 : removed);
        // Physical return never clears the original payable; only the receipt
        // creates an additional payable. No debit note is posted in these cases.
        expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-11000);
        expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(0);
        const posted = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: ret.id } });
        expect(posted.status).toBe(voiding ? 'VOID' : 'APPROVED'); expect(posted.postedAt).not.toBeNull();
        expect((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: originalLot.id } })).unitCost.toString()).toBe(originalLot.unitCost.toString());
        const outbound = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: f.org.orgId, documentType: 'PURCHASE_RETURN', documentId: ret.id } });
        expect(outbound).toHaveLength(1); expect(Number(outbound[0].valueChange)).toBe(voiding ? -2000 : -removed);
        expect(outbound[0].warehouseId).toBeNull();
        if (voiding) {
          const restored = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: f.org.orgId, documentType: 'ADJUSTMENT', documentId: ret.id } });
          expect(restored).toHaveLength(1); expect(Number(restored[0].valueChange)).toBe(2000); expect(restored[0].warehouseId).toBeNull();
        }
        await assertTrialBalanced(f.org.orgId);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }
  for (const { voiding, consumed } of [{ voiding: false, consumed: false }, { voiding: true, consumed: false }, { voiding: true, consumed: true }]) for (const returnFirst of [true, false]) {
    it(`${voiding ? 'return void' : 'return restock'} versus ${consumed ? 'dependent' : 'independent'} sale: ${returnFirst ? 'return' : 'sale'} wins with exact warehouse cost`, async () => {
      const f = await fixture();
      let release!: () => void, firstResult: Promise<unknown> | undefined, secondResult: Promise<unknown> | undefined;
      try {
        await receive(f, f.a, 5, 1000, 'FIRST');
        // Keep another warehouse at an unrelated cost to expose scope leakage.
        await receive(f, f.b, 2, 9000, 'OTHER', 2);
        const source = await invoice(f, 2);
        await prisma.$transaction(tx => send(tx, f, source.id, f.a));
        // A void needs unchanged carrying value. Revalued-return refusals
        // are covered separately; these void races use equal-price receipts.
        await receive(f, f.a, 3, voiding ? 1000 : 2000, 'LATER', 3);
        const sourceLine = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: source.id } });
        const ret = await prisma.salesReturn.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, invoiceId: source.id,
          number: 'RETURN-RACE', returnDate: DATE, status: 'APPROVED', warehouseId: f.a,
          lines: { create: { lineNo: 1, itemId: f.itemId, itemName: 'Stock', sourceInvoiceLineId: sourceLine.id, qtyReturn: 2, goodsReceived: true } } } });
        if (voiding) await prisma.$transaction(tx => postSalesReturnOnApproval(tx, ret.id));
        const sale = await invoice(f, consumed ? 7 : 2, 'NEXT-SALE');
        const returnAction = (tx: Prisma.TransactionClient) => voiding
          ? voidSalesReturn(tx, f.org.orgId, ret.id, { date: DATE })
          : postSalesReturnOnApproval(tx, ret.id);
        const saleAction = (tx: Prisma.TransactionClient) => send(tx, f, sale.id, f.a);
        let ready!: () => void, identify!: (pid: number) => void;
        const started = new Promise<void>(done => { ready = done; });
        const hold = new Promise<void>(done => { release = done; });
        const identified = new Promise<number>(done => { identify = done; });
        const refused = consumed || (voiding && !returnFirst);
        let winningSnapshot: Awaited<ReturnType<typeof stockSnapshot>> | undefined;
        const first = prisma.$transaction(async tx => {
          await (returnFirst ? returnAction(tx) : saleAction(tx));
          if (refused) winningSnapshot = await stockSnapshot(tx, f.org.orgId);
          ready(); await hold;
        }, { timeout: 15000 });
        firstResult = first.then(() => null, error => error);
        await Promise.race([started, first.then(() => { throw new Error('First operation did not hold its locks'); })]);
        secondResult = prisma.$transaction(async tx => {
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          identify(row.pid); await (returnFirst ? saleAction(tx) : returnAction(tx));
        }, { timeout: 15000 }).then(() => null, error => error);
        const pid = await identified, deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
          if (row.blocked) { blocked = true; break; }
          await new Promise(done => setTimeout(done, 10));
        }
        expect(blocked).toBe(true); release();
        expect(await firstResult).toBeNull();
        if (refused) {
          expect(await secondResult).toMatchObject({ status: 422 });
          expect((await secondResult as Error).message).toContain(returnFirst ? 'Insufficient stock' : 'later SALES NEXT-SALE');
          expect(await prisma.$transaction(tx => stockSnapshot(tx, f.org.orgId))).toEqual(winningSnapshot);
        } else expect(await secondResult).toBeNull();
        // Restock adds the old 2,000 sale cost, never the new 1,500 average.
        // Return-first: 11,000/8 × 2 = 2,750; sale-first: 9,000/6 × 2 = 3,000.
        // Void cases keep a 1,000 average so the untouched return is eligible.
        const value = consumed ? (returnFirst ? 6000 : 1000) : voiding ? (returnFirst ? 4000 : 6000) : (returnFirst ? 8250 : 8000);
        const quantity = consumed ? (returnFirst ? 6 : 1) : voiding ? (returnFirst ? 4 : 6) : 6;
        const saleCost = consumed ? (returnFirst ? 0 : 7000) : voiding ? 2000 : (returnFirst ? 2750 : 3000);
        expect(await pool(f, f.a)).toEqual({ quantity, lotQuantity: quantity, value, lotValue: value });
        expect(await pool(f, f.b)).toEqual({ quantity: 2, lotQuantity: 2, value: 18000, lotValue: 18000 });
        expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(value + 18000);
        const returnVoided = voiding && returnFirst;
        expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(saleCost + (returnVoided ? 2000 : 0));
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(consumed ? (returnFirst ? 6000 : 27000) : 12000);
        expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe(returnVoided ? 'VOID' : 'APPROVED');
        const movements = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: f.org.orgId, documentType: 'SALES', documentId: sale.id } });
        if (consumed && returnFirst) {
          expect(movements).toHaveLength(0);
          expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('DRAFT');
        } else {
          expect(movements).toHaveLength(1);
          expect(Number(movements[0].valueChange)).toBe(-saleCost);
          expect(movements[0].warehouseId).toBe(f.a);
        }
        await assertTrialBalanced(f.org.orgId);
      } finally { if (release) release(); await firstResult; await secondResult; await cleanupOrg(f.org.orgId); }
    });
  }
  it('mixed fulfillment costs each warehouse independently, then void restores the exact warehouses and values', async () => {
    const f = await fixture();
    try {
      await receive(f, f.a, 5, 1000, 'A'); await receive(f, f.b, 5, 1200, 'B', 2); await receive(f, null, 2, 2000, 'UNASSIGNED', 3);
      const original = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      const sale = await invoice(f, 7);
      await prisma.$transaction(tx => send(tx, f, sale.id));
      expect(await pool(f, f.a)).toEqual({ quantity: 0, lotQuantity: 0, value: 0, lotValue: 0 });
      expect(await pool(f, f.b)).toEqual({ quantity: 3, lotQuantity: 3, value: 3600, lotValue: 3600 });
      expect(await pool(f, null)).toEqual({ quantity: 2, lotQuantity: 2, value: 4000, lotValue: 4000 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(7600);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(7400);
      await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, sale.id, { date: DATE }));
      expect(await pool(f, f.a)).toEqual({ quantity: 5, lotQuantity: 5, value: 5000, lotValue: 5000 });
      expect(await pool(f, f.b)).toEqual({ quantity: 5, lotQuantity: 5, value: 6000, lotValue: 6000 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(15000);
      expect(await inventoryLotValue(f.org.orgId)).toBe(15000);
      const restored = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      expect(restored.map(lot => [lot.id, lot.unitCost.toString()])).toEqual(original.map(lot => [lot.id, lot.unitCost.toString()]));
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('an explicit warehouse cannot borrow another warehouse stock; failed send restores document and ledger', async () => {
    const f = await fixture();
    try {
      await receive(f, f.a, 5, 1000, 'A'); await receive(f, f.b, 5, 1200, 'B', 2);
      const sale = await invoice(f, 6);
      await expect(prisma.$transaction(tx => send(tx, f, sale.id, f.a))).rejects.toThrow('Insufficient stock');
      expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('DRAFT');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(11000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(11000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(0);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, documentType: 'SALES' } })).toBe(0);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('customer restocking and immediate void preserve original value despite carrying-value reallocation', async () => {
    const f = await fixture();
    try {
      await receive(f, f.a, 5, 1000, 'A'); await receive(f, f.b, 5, 1200, 'B', 2);
      const sale = await invoice(f, 7); await prisma.$transaction(tx => send(tx, f, sale.id));
      const line = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: sale.id } });
      const ret = await prisma.salesReturn.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, invoiceId: sale.id,
        number: 'RETURN', returnDate: DATE, status: 'APPROVED', warehouseId: f.b,
        lines: { create: { lineNo: 1, itemId: f.itemId, itemName: 'Stock', sourceInvoiceLineId: line.id, qtyReturn: 2, goodsReceived: true } } } });
      await prisma.$transaction(tx => postSalesReturnOnApproval(tx, ret.id));
      // Sale cost = 7400 for seven units. Two returned units restore 2114.29.
      expect(await pool(f, f.b)).toEqual({ quantity: 5, lotQuantity: 5, value: 5714.29, lotValue: 5714.29 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(5714.29);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(5285.71);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(21000);
      await prisma.$transaction(tx => voidSalesReturn(tx, f.org.orgId, ret.id, { date: DATE }));
      expect(await pool(f, f.b)).toEqual({ quantity: 3, lotQuantity: 3, value: 3600, lotValue: 3600 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(3600);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(7400);
      expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(21000);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('supplier return and void move warehouse book value through clearing, leaving AP unchanged', async () => {
    const f = await fixture();
    try {
      await receive(f, f.b, 3, 1200, 'OPENING');
      const vendorId = await createVendor(f.org.orgId);
      const bill = await prisma.bill.create({ data: { organizationId: f.org.orgId, vendorId, number: 'PURCHASE', issueDate: DATE,
        status: 'OPEN', totalAmount: 3600, lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', quantity: 3, price: 1200, lineTotal: 3600 } } }, include: { lines: true } });
      await prisma.$transaction(tx => postBillToLedger(tx, f.org.orgId, bill));
      const ret = await prisma.purchaseReturn.create({ data: { organizationId: f.org.orgId, vendorId, number: 'SUPPLIER-RETURN',
        billId: bill.id, returnDate: DATE, status: 'APPROVED', warehouseId: f.b, returnAccountId: f.org.accounts.grIrClearing,
        lines: { create: { lineNo: 1, itemId: f.itemId, description: 'Stock', qtyReturn: 1 } } } });
      await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, ret.id));
      expect(await pool(f, f.b)).toEqual({ quantity: 2, lotQuantity: 2, value: 2400, lotValue: 2400 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.grIrClearing)).toBe(1200);
      expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-3600);
      await prisma.$transaction(tx => voidPurchaseReturn(tx, f.org.orgId, ret.id, { date: DATE }));
      expect(await pool(f, f.b)).toEqual({ quantity: 3, lotQuantity: 3, value: 3600, lotValue: 3600 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.grIrClearing)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-3600);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(7200);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('removing an untouched receipt refuses if its original value would leave an impossible pool', async () => {
    const f = await fixture();
    try {
      await receive(f, f.a, 5, 1000, 'CHEAP'); await receive(f, f.a, 5, 5000, 'EXPENSIVE', 2);
      const sale = await invoice(f, 4); await prisma.$transaction(tx => send(tx, f, sale.id, f.a));
      const before = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      await expect(prisma.$transaction(tx => reverseAddedLayers(tx, f.org.orgId, 'ADJUSTMENT', 'EXPENSIVE', DATE))).rejects.toThrow('later SALES SALE');
      expect(await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } })).toEqual(before);
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(18000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(18000);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  for (const switchFirst of [true, false]) it(`method change versus sale: ${switchFirst ? 'switch' : 'sale'} commits first with a real lock wait`, async () => {
    const f = await fixture('FIFO');
    let release!: () => void;
    try {
      await receive(f, f.a, 5, 1000, 'CHEAP'); await receive(f, f.a, 5, 1200, 'EXPENSIVE', 2);
      const sale = await invoice(f, 4);
      let ready!: () => void, identify!: (value: number) => void;
      const started = new Promise<void>(done => { ready = done; }), hold = new Promise<void>(done => { release = done; });
      const identified = new Promise<number>(done => { identify = done; });
      const change = (tx: Prisma.TransactionClient) => changeInventoryCostingMethod(tx, f.org.orgId, 'WEIGHTED_AVERAGE', DATE);
      const sell = (tx: Prisma.TransactionClient) => send(tx, f, sale.id, f.a);
      const first = prisma.$transaction(async tx => { await (switchFirst ? change(tx) : sell(tx)); ready(); await hold; }, { timeout: 15000 });
      const settledFirst = first.then(() => null, error => error);
      let settledSecond: Promise<unknown> | undefined;
      try {
        await Promise.race([started, first.then(() => { throw new Error('First operation did not wait'); })]);
        const second = prisma.$transaction(async tx => {
          const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          identify(rows[0].pid); await (switchFirst ? sell(tx) : change(tx));
        }, { timeout: 15000 });
        settledSecond = second.then(() => null, error => error);
        const pid = await identified, deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
          if (rows[0].blocked) { blocked = true; break; }
          await new Promise(done => setTimeout(done, 10));
        }
        expect(blocked).toBe(true);
      } finally { release(); await settledFirst; if (settledSecond) await settledSecond; }
      expect(await settledFirst).toBeNull(); expect(await settledSecond).toBeNull();
      const expected = switchFirst ? 6600 : 7000;
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(expected);
      expect(await inventoryLotValue(f.org.orgId)).toBe(expected);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(expected);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(switchFirst ? 4400 : 4000);
    } finally { if (release) release(); await cleanupOrg(f.org.orgId); }
  });
});
