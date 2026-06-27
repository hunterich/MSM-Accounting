/**
 * Regression: a warehouse-scoped stock count must measure variance against the
 * counted WAREHOUSE's on-hand — not company-wide stock — and post the generated
 * adjustment into that warehouse's cost layers.
 *
 * Finding 5a — `postStockCount` grouped live on-hand by `itemId` only (summing
 * every warehouse) and posted the adjustment with a hardcoded `warehouseId:
 * null`. So a count of 7 in WH-1 against 10 in WH-1 + 10 in WH-2 booked a
 * variance of -13 (vs company-wide 20) and relieved layers across both
 * warehouses. The fix scopes the live-qty lookup and the posting to
 * `count.warehouseId`.
 *
 * Run with:  npm run test:int -- stock-count-warehouse
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { postStockCount } from '../../stock-count-posting';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import {
  prisma,
  createTestOrg,
  createItem,
  assertTrialBalanced,
  assertInventoryReconciled,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-23T00:00:00.000Z');

/** Seed `qty` @ `unitCost` into a specific warehouse (lot + ledger + GL variance). */
let seedSeq = 0;
async function seedWarehouseStock(org: TestOrg, itemId: string, warehouseId: string, qty: number, unitCost: number) {
  seedSeq += 1;
  await prisma.$transaction((tx) =>
    postStockAdjustmentToLedger(tx, org.orgId, {
      id: `seed-${seedSeq}-${randomUUID().slice(0, 6)}`,
      number: `SEED-${seedSeq}`,
      date: DATE,
      warehouseId,
      lines: [{ itemId, oldQty: 0, newQty: qty, unitCost }],
    }),
  );
}

async function onHandInWarehouse(orgId: string, itemId: string, warehouseId: string) {
  const r = await prisma.inventoryLot.aggregate({
    where: { organizationId: orgId, itemId, warehouseId },
    _sum: { qtyBalance: true },
  });
  return Number(r._sum.qtyBalance ?? 0);
}

describe('warehouse-aware stock count', () => {
  it('measures variance against the counted warehouse and posts into it', async () => {
    const org = await createTestOrg();
    const wh1 = org.warehouseId; // seeded by the harness
    const wh2 = (
      await prisma.warehouse.create({
        data: { organizationId: org.orgId, code: 'WH-2', name: 'Second Warehouse' },
        select: { id: true },
      })
    ).id;
    const itemId = await createItem(org.orgId, 1000);

    // 10 units in WH-1, 10 units in WH-2 → company-wide on-hand = 20.
    await seedWarehouseStock(org, itemId, wh1, 10, 1000);
    await seedWarehouseStock(org, itemId, wh2, 10, 1000);
    expect(await onHandInWarehouse(org.orgId, itemId, wh1)).toBeCloseTo(10, 4);
    expect(await onHandInWarehouse(org.orgId, itemId, wh2)).toBeCloseTo(10, 4);

    // Count item in WH-1: counted 7. The WH-1 variance is 7 - 10 = -3 (NOT 7 - 20).
    const count = await prisma.stockCount.create({
      data: {
        organizationId: org.orgId,
        number: `SC-WH-${randomUUID().slice(0, 6)}`,
        date: DATE,
        status: 'SUBMITTED',
        warehouseId: wh1,
        lines: { create: [{ lineNo: 1, itemId, systemQty: 10, countedQty: 7, unitCost: 1000 }] },
      },
      include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
    });

    const adjId = await prisma.$transaction((tx) =>
      postStockCount(tx, org.orgId, {
        id: count.id,
        number: count.number,
        date: DATE,
        warehouseId: wh1,
        lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
      }),
    );
    expect(adjId).toBeTruthy();

    // WH-1 moved to the count (10 → 7); WH-2 is untouched (still 10).
    expect(await onHandInWarehouse(org.orgId, itemId, wh1)).toBeCloseTo(7, 4);
    expect(await onHandInWarehouse(org.orgId, itemId, wh2)).toBeCloseTo(10, 4);

    // The generated adjustment booked a -3 variance into WH-1 (not -13, not null).
    const adj = await prisma.stockAdjustment.findUnique({
      where: { id: adjId! },
      select: { warehouseId: true, lines: { select: { qtyDiff: true } } },
    });
    expect(adj?.warehouseId).toBe(wh1);
    expect(Number(adj?.lines[0]?.qtyDiff)).toBeCloseTo(-3, 4);

    await assertTrialBalanced(org.orgId, 'warehouse count');
    await assertInventoryReconciled(org.orgId, 'warehouse count');

    await cleanupOrg(org.orgId);
  });
});
