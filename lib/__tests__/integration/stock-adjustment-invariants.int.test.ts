/**
 * GL invariants for the STOCK ADJUSTMENT posting path
 * (lib/stock-adjustment-posting.ts), run against the real test database.
 *
 * Covers direction correctness, trial balance, net-zero batches, and
 * ledger↔GL reconciliation. The final test pins a KNOWN BUG: adjustments write
 * the inventory ledger and GL but do NOT update InventoryLot cost layers, so
 * on-hand *lot* valuation drifts from the ledger/GL after an adjustment.
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

/** Receive `qty` units @ `unitCost` via a manual-inventory bill (creates a cost layer). */
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number) {
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-${itemId.slice(-6)}`, vendorId, issueDate: DATE, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) =>
    postBillToLedger(tx, org.orgId, {
      id: bill.id,
      number: bill.number,
      issueDate: DATE,
      apAccountId: null,
      taxable: false,
      taxInclusive: false,
      taxRate: 0,
      lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
    }),
  );
}

describe('GL invariant: stock adjustment direction + reconciliation', () => {
  it('an increase debits Inventory and credits Variance, and reconciles to the ledger', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await postAdjustment(org, [{ itemId, oldQty: 0, newQty: 10, unitCost: 1000 }]);

    await assertTrialBalanced(org.orgId, 'adjustment increase');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(10000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(-10000, 2);
    // Inventory GL == ledger value.
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(
      await inventoryLedgerValue(org.orgId),
      2,
    );

    await cleanupOrg(org.orgId);
  });

  it('a decrease debits Variance and credits Inventory', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 4, unitCost: 1000 }]);

    await assertTrialBalanced(org.orgId, 'adjustment decrease');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(-6000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(6000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(-6000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a net-zero batch writes per-line ledger rows but posts no journal entry', async () => {
    const org = await createTestOrg();
    const itemA = await createItem(org.orgId);
    const itemB = await createItem(org.orgId);

    // +5 @ 1000 and -5 @ 1000 => net 0.
    await postAdjustment(org, [
      { itemId: itemA, oldQty: 0, newQty: 5, unitCost: 1000 },
      { itemId: itemB, oldQty: 5, newQty: 0, unitCost: 1000 },
    ]);

    expect(await journalEntryCount(org.orgId)).toBe(0);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(0, 2);
    const ledgerRows = await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } });
    expect(ledgerRows).toBe(2);
    await assertTrialBalanced(org.orgId, 'net-zero batch');

    await cleanupOrg(org.orgId);
  });

  it('after a receipt + adjustment, the inventory GL still equals the ledger', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 10, 1000); // GL 10000, ledger 10000, lots 10000
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 15, unitCost: 1000 }]); // +5000

    await assertTrialBalanced(org.orgId, 'receipt + adjustment');
    // GL and the perpetual ledger DO stay in sync (both include the adjustment).
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(15000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(15000, 2);

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: stock adjustment cost-layer sync', () => {
  // KNOWN BUG — adjustments update the ledger + GL but never touch InventoryLot,
  // so open-lot valuation diverges from the ledger after an adjustment. This is
  // expected to FAIL until stock adjustments also write/relieve cost layers.
  // When that is fixed, this test will start PASSING — remove the `.fails`.
  it.fails(
    'open cost-layer (lot) value should reconcile with the ledger after an adjustment',
    async () => {
      const org = await createTestOrg();
      const itemId = await createItem(org.orgId);

      await receiveStock(org, itemId, 10, 1000); // lots 10000, ledger 10000
      await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 15, unitCost: 1000 }]); // +5000

      const ledger = await inventoryLedgerValue(org.orgId); // 15000
      const lots = await inventoryLotValue(org.orgId); // 10000 today (bug)

      // Correct behavior: lots == ledger. Fails today because the adjustment
      // did not create a +5 cost layer.
      expect(lots).toBeCloseTo(ledger, 2);
    },
  );
});
