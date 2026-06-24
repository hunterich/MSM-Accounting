/**
 * Stock adjustment void round-trip against a real Postgres DB, exercising a
 * MIXED adjustment (one line increases stock, another decreases it). Voiding
 * reverses the variance JE, removes the increase layer, and restores the
 * decrease draw-down — returning the trial balance and inventory to the
 * pre-adjustment state, reconciled.
 *
 * Run with:  npm run test:int   (test DB needs StockAdjustmentStatus 'VOID')
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer } from '../../inventory-costing';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { voidStockAdjustment } from '../../stock-adjustment-void';
import {
  prisma,
  createTestOrg,
  createItem,
  assertTrialBalanced,
  inventoryLotValue,
  assertInventoryReconciled,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-20T00:00:00.000Z');

describe('stock adjustment void round-trip (mixed increase + decrease)', () => {
  it('reverses the variance JE, removes the increase, restores the decrease', async () => {
    const org = await createTestOrg();
    const itemUp = await createItem(org.orgId);
    const itemDown = await createItem(org.orgId);

    // Base stock for the item that will be decreased: 10 @ 100.
    await prisma.$transaction((tx) => addCostLayer(tx, org.orgId, itemDown, null, 10, 100, InventoryDocumentType.PURCHASE, 'po-1', DATE));
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);

    const adj = await prisma.stockAdjustment.create({
      data: { organizationId: org.orgId, number: 'ADJ-VOID-1', date: DATE, reason: 'Void round-trip' },
      select: { id: true, number: true },
    });

    // Post the adjustment: itemUp +5 @ 200 (=+1000); itemDown -3 @ 100 carrying (=-300). Net +700.
    await prisma.$transaction((tx) => postStockAdjustmentToLedger(tx, org.orgId, {
      id: adj.id,
      number: adj.number,
      date: DATE,
      warehouseId: null,
      lines: [
        { itemId: itemUp, oldQty: 0, newQty: 5, unitCost: 200 },
        { itemId: itemDown, oldQty: 10, newQty: 7, unitCost: 100 },
      ],
    }));

    await assertTrialBalanced(org.orgId, 'adjustment posted');
    await assertInventoryReconciled(org.orgId, 'adjustment posted');
    // itemDown 7@100 (700) + itemUp 5@200 (1000) = 1700.
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1700, 2);

    await prisma.$transaction((tx) => voidStockAdjustment(tx, org.orgId, adj.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'adjustment voided');
    await assertInventoryReconciled(org.orgId, 'adjustment voided');
    // Back to pre-adjustment: itemUp removed (0), itemDown restored to 10@100 (1000).
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);
    expect(await journalEntryCount(org.orgId)).toBe(2); // variance post + reversal

    const voided = await prisma.stockAdjustment.findUnique({ where: { id: adj.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});
