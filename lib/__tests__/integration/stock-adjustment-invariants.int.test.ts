/**
 * GL invariants for the STOCK ADJUSTMENT posting path
 * (lib/stock-adjustment-posting.ts), run against the real test database.
 *
 * Adjustments now write/relieve InventoryLot cost layers, so lot valuation stays
 * in sync with the ledger and GL (FIFO). Under weighted-average the lot-sum
 * diverges from the ledger by a pre-existing model issue (layers keep original
 * costs; WA values consumption at the blended rate) — pinned with it.fails.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { postBillToLedger } from '../../bill-posting';
import {
  prisma,
  createTestOrg,
  createVendor,
  createItem,
  assertTrialBalanced,
  accountBalance,
  inventoryLedgerValue,
  inventoryLotValue,
  journalEntryCount,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-03-20T00:00:00.000Z');
const DATE_A = new Date('2026-03-18T00:00:00.000Z'); // older FIFO layer
const DATE_B = new Date('2026-03-19T00:00:00.000Z'); // newer FIFO layer

let adjSeq = 0;
async function postAdjustment(
  org: TestOrg,
  lines: Array<{ itemId: string; oldQty: number; newQty: number; unitCost: number }>,
) {
  adjSeq += 1;
  await prisma.$transaction((tx) =>
    postStockAdjustmentToLedger(tx, org.orgId, {
      id: `adj-${adjSeq}`,
      number: `ADJ-${adjSeq}`,
      date: DATE,
      warehouseId: null,
      lines,
    }),
  );
}

let rcvSeq = 0;
/** Receive `qty` @ `unitCost` via a manual-inventory bill (creates a cost layer). */
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number, date: Date = DATE) {
  rcvSeq += 1;
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-${rcvSeq}`, vendorId, issueDate: date, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) =>
    postBillToLedger(tx, org.orgId, {
      id: bill.id,
      number: bill.number,
      issueDate: date,
      apAccountId: null,
      taxable: false,
      taxInclusive: false,
      taxRate: 0,
      lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
    }),
  );
}

async function setWeightedAverage(orgId: string) {
  await prisma.organization.update({ where: { id: orgId }, data: { costingMethod: 'WEIGHTED_AVERAGE' } });
}

describe('GL invariant: stock adjustment direction + lot reconciliation', () => {
  it('an increase debits Inventory, credits Variance, and reconciles lots/ledger/GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await postAdjustment(org, [{ itemId, oldQty: 0, newQty: 10, unitCost: 1000 }]);

    await assertTrialBalanced(org.orgId, 'adjustment increase');
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(10000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(-10000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(10000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(10000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a FIFO decrease relieves layers at carrying cost and reconciles lots/ledger/GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 10, 1000); // lots/ledger/GL = 10000
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 4, unitCost: 1000 }]); // -6 @ 1000 = -6000

    await assertTrialBalanced(org.orgId, 'adjustment decrease');
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(4000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(6000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(4000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(4000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a net-zero batch writes lot/ledger rows but posts no adjustment journal entry', async () => {
    const org = await createTestOrg();
    const itemA = await createItem(org.orgId);
    const itemB = await createItem(org.orgId);

    await receiveStock(org, itemB, 5, 1000); // itemB has 5 @ 1000 to relieve
    const jeBefore = await journalEntryCount(org.orgId);

    // +5 @ 1000 (new layer) and -5 @ 1000 (relieve itemB) => net 0
    await postAdjustment(org, [
      { itemId: itemA, oldQty: 0, newQty: 5, unitCost: 1000 },
      { itemId: itemB, oldQty: 5, newQty: 0, unitCost: 1000 },
    ]);

    expect((await journalEntryCount(org.orgId)) - jeBefore).toBe(0); // adjustment posted no JE
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(5000, 2); // itemA +5000; itemB receipt +5000 then relieved -5000 = net 0
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(5000, 2);
    await assertTrialBalanced(org.orgId, 'net-zero batch');

    await cleanupOrg(org.orgId);
  });

  it('after a receipt + increase adjustment, lots, ledger, and GL all reconcile', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 10, 1000); // 10000
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 15, unitCost: 1000 }]); // +5 @ 1000

    await assertTrialBalanced(org.orgId, 'receipt + adjustment');
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(15000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(15000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(15000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a FIFO decrease consumes the oldest layer first at its actual cost (typed cost ignored)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 5, 1000, DATE_A); // older layer
    await receiveStock(org, itemId, 5, 1200, DATE_B); // newer layer
    // decrease 6 => 5 @ 1000 + 1 @ 1200 = 6200 (typed cost 9999 must be ignored)
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 4, unitCost: 9999 }]);

    await assertTrialBalanced(org.orgId, 'fifo mixed');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(6200, 2);
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(4800, 2); // 11000 - 6200
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(4800, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(4800, 2); // remaining 4 @ 1200

    await cleanupOrg(org.orgId);
  });

  it('a decrease with no cost layers does not throw (correction tool)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    // No receipt — zero layers. A decrease must not throw.
    await postAdjustment(org, [{ itemId, oldQty: 3, newQty: 0, unitCost: 500 }]);
    await assertTrialBalanced(org.orgId, 'no-layer decrease');

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: weighted-average adjustment', () => {
  it('a WA decrease posts the blended cost to ledger and GL', async () => {
    const org = await createTestOrg();
    await setWeightedAverage(org.orgId);
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 5, 1000, DATE_A);
    await receiveStock(org, itemId, 5, 1200, DATE_B); // WA = 1100
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 6, unitCost: 9999 }]); // -4 @ 1100 = 4400

    await assertTrialBalanced(org.orgId, 'WA decrease');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(4400, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(6600, 2); // 11000 - 4400
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(6600, 2);

    await cleanupOrg(org.orgId);
  });

  // KNOWN PRE-EXISTING WA divergence: lot-sum keeps original per-layer costs while
  // WA values consumption at the blended rate, so lots != ledger under WA. This is
  // not specific to adjustments (sales COGS has it too). Flip to passing when the
  // WA cost-layer model is fixed (collapse to a single blended layer).
  it.fails('under WA, lot value should reconcile with the ledger (pre-existing divergence)', async () => {
    const org = await createTestOrg();
    await setWeightedAverage(org.orgId);
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 5, 1000, DATE_A);
    await receiveStock(org, itemId, 5, 1200, DATE_B);
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 6, unitCost: 9999 }]);

    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(await inventoryLedgerValue(org.orgId), 2);

    await cleanupOrg(org.orgId);
  });
});
