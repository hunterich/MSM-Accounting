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
});
