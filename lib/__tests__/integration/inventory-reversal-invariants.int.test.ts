/**
 * Inventory reversal-primitive invariants (Phase 2 foundation), against a real
 * Postgres DB:
 *   - reverseAddedLayers removes the inbound layers a document added, blocking
 *     if any was drawn down.
 *   - restoreConsumedLayers re-adds stock a document drew down, value-neutral.
 * Both keep the inventory ledger and cost layers reconciled.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import {
  addCostLayer,
  relieveCostLayers,
  reverseAddedLayers,
  restoreConsumedLayers,
} from '../../inventory-costing';
import {
  prisma,
  createTestOrg,
  createItem,
  inventoryLotValue,
  assertInventoryReconciled,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-20T00:00:00.000Z');

describe('reverseAddedLayers round-trip', () => {
  it('removes an untouched restock layer and returns inventory to zero', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, org.warehouseId, 5, 200, InventoryDocumentType.SALES_RETURN, 'sr-1', DATE),
    );
    await assertInventoryReconciled(org.orgId, 'after restock');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);

    const removed = await prisma.$transaction((tx) =>
      reverseAddedLayers(tx, org.orgId, InventoryDocumentType.SALES_RETURN, 'sr-1', DATE),
    );
    expect(removed).toBeCloseTo(1000, 2);
    await assertInventoryReconciled(org.orgId, 'after reverse');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(0, 2);

    await cleanupOrg(org.orgId);
  });

  it('refuses to reverse a layer that has already been drawn down', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, org.warehouseId, 5, 200, InventoryDocumentType.SALES_RETURN, 'sr-2', DATE),
    );
    // Consume 2 of the 5 restocked units.
    await prisma.$transaction((tx) =>
      relieveCostLayers(tx, org.orgId, itemId, org.warehouseId, 2, InventoryDocumentType.SALES, 'inv-x', DATE),
    );

    await expect(
      prisma.$transaction((tx) => reverseAddedLayers(tx, org.orgId, InventoryDocumentType.SALES_RETURN, 'sr-2', DATE)),
    ).rejects.toThrow(/consumed|sold/i);

    await cleanupOrg(org.orgId);
  });
});

describe('restoreConsumedLayers round-trip', () => {
  it('un-consumes a document\'s draw-down and restores inventory value', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    // Receive 10 @ 100.
    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, org.warehouseId, 10, 100, InventoryDocumentType.PURCHASE, 'po-1', DATE),
    );
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);

    // An invoice consumes 4 (tagged SALES).
    const cost = await prisma.$transaction((tx) =>
      relieveCostLayers(tx, org.orgId, itemId, org.warehouseId, 4, InventoryDocumentType.SALES, 'inv-1', DATE),
    );
    expect(cost).toBeCloseTo(400, 2);
    await assertInventoryReconciled(org.orgId, 'after consume');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(600, 2);

    // Voiding the invoice un-consumes its SALES draw-down.
    const restored = await prisma.$transaction((tx) =>
      restoreConsumedLayers(tx, org.orgId, InventoryDocumentType.SALES, 'inv-1', DATE),
    );
    expect(restored).toBeCloseTo(400, 2);
    await assertInventoryReconciled(org.orgId, 'after restore');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);

    await cleanupOrg(org.orgId);
  });

  it('restores exactly (value-neutral) across multiple FIFO lots with a non-divisible per-unit cost', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    // Two purchase lots at different costs: total 3 units worth 250.
    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, org.warehouseId, 2, 100, InventoryDocumentType.PURCHASE, 'po-a', new Date('2026-06-01')),
    );
    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, org.warehouseId, 1, 50, InventoryDocumentType.PURCHASE, 'po-b', new Date('2026-06-02')),
    );
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(250, 2);

    // Consume all 3 across both lots → cogsPerUnit = 250/3 = 83.333… (rounds to 83.33).
    const cost = await prisma.$transaction((tx) =>
      relieveCostLayers(tx, org.orgId, itemId, org.warehouseId, 3, InventoryDocumentType.SALES, 'inv-2', DATE),
    );
    expect(cost).toBeCloseTo(250, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(0, 2);

    // Un-consume: anchoring on the recorded valueChange must restore exactly 250,
    // not 3 × 83.33 = 249.99. Proven here against real Decimal columns.
    const restored = await prisma.$transaction((tx) =>
      restoreConsumedLayers(tx, org.orgId, InventoryDocumentType.SALES, 'inv-2', DATE),
    );
    expect(restored).toBeCloseTo(250, 2);
    await assertInventoryReconciled(org.orgId, 'after non-divisible restore');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(250, 2);

    await cleanupOrg(org.orgId);
  });
});
