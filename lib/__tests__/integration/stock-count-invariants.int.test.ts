/**
 * Integration: posting a Stock Count generates a StockAdjustment that moves the
 * book to exactly the counted quantities, with lots = ledger = GL (FIFO).
 * Run with: npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postStockCount } from '../../stock-count-posting';
import { postBillToLedger } from '../../bill-posting';
import {
  prisma, createTestOrg, createVendor, createItem,
  assertTrialBalanced, accountBalance, inventoryLedgerValue, inventoryLotValue,
  cleanupOrg, disconnect, type TestOrg,
} from './harness';

afterAll(async () => { await disconnect(); });

const DATE = new Date('2026-06-23T00:00:00.000Z');

let billSeq = 0;
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number) {
  billSeq += 1;
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-${billSeq}`, vendorId, issueDate: DATE, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) => postBillToLedger(tx, org.orgId, {
    id: bill.id, number: bill.number, issueDate: DATE, apAccountId: null,
    taxable: false, taxInclusive: false, taxRate: 0,
    lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
  }));
}

async function onHand(orgId: string, itemId: string) {
  const r = await prisma.inventoryLot.aggregate({ where: { organizationId: orgId, itemId }, _sum: { qtyBalance: true } });
  return Number(r._sum.qtyBalance ?? 0);
}

async function seedCount(org: TestOrg, lines: Array<{ itemId: string; systemQty: number; countedQty: number | null; unitCost: number }>) {
  const count = await prisma.stockCount.create({
    data: {
      organizationId: org.orgId, number: `SC-${billSeq}-${Math.round(lines.length)}`, date: DATE, status: 'SUBMITTED', warehouseId: null,
      lines: { create: lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })) },
    },
    include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
  });
  return count;
}

describe('GL invariant: stock count post', () => {
  it('a count-down posts an adjustment so on-hand equals the count, lots = ledger = GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId, 1000);
    await receiveStock(org, itemId, 10, 1000); // on-hand 10, lots/ledger/GL = 10000

    const count = await seedCount(org, [{ itemId, systemQty: 10, countedQty: 7, unitCost: 1000 }]);
    const adjId = await prisma.$transaction((tx) => postStockCount(tx, org.orgId, {
      id: count.id, number: count.number, date: DATE, warehouseId: null,
      lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
    }));

    expect(adjId).toBeTruthy();
    expect(await onHand(org.orgId, itemId)).toBeCloseTo(7, 4); // book == counted
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(7000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(7000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(7000, 2);
    await assertTrialBalanced(org.orgId, 'stock count down');

    await cleanupOrg(org.orgId);
  });

  it('skips blank and zero-variance lines (no adjustment when nothing varied)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId, 1000);
    await receiveStock(org, itemId, 5, 1000);

    // counted equals live → zero variance
    const count = await seedCount(org, [{ itemId, systemQty: 5, countedQty: 5, unitCost: 1000 }]);
    const adjId = await prisma.$transaction((tx) => postStockCount(tx, org.orgId, {
      id: count.id, number: count.number, date: DATE, warehouseId: null,
      lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
    }));

    expect(adjId).toBeNull(); // no adjustment generated
    expect(await onHand(org.orgId, itemId)).toBeCloseTo(5, 4);

    await cleanupOrg(org.orgId);
  });
});
