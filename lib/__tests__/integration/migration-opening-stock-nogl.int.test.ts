/**
 * Integration: migration mode — opening stock writes the lot but posts NO journal.
 *
 * During a data migration the trial balance ALREADY carries the inventory-asset
 * balance, so re-posting the opening-stock journal (DR Inventory / CR Opening
 * Balance Equity) would double-count inventory. Migration therefore needs the
 * perpetual on-hand lot WITHOUT the journal. This proves the `postGl: false`
 * opt-out writes the InventoryLot but leaves the journal-entry count unchanged.
 *
 * Run with: npm run test:int -- migration-opening-stock-nogl
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postOpeningStockIfNeeded } from '../../inventory-opening';
import {
  prisma, createTestOrg, inventoryLotValue, journalEntryCount, cleanupOrg, disconnect,
} from './harness';

afterAll(async () => { await disconnect(); });
const DATE = new Date('2026-01-01T00:00:00.000Z');

describe('opening stock, migration mode (postGl=false)', () => {
  it('writes the lot but posts NO journal entry', async () => {
    const org = await createTestOrg();
    const item = await prisma.item.create({
      data: {
        organizationId: org.orgId, name: 'Widget', sku: 'WIDGET',
        type: 'PRODUCT', unit: 'PCS', sellingPrice: 0,
        costPrice: 1_000_000, openingStock: 5,
      },
    });

    const before = await journalEntryCount(org.orgId);
    await prisma.$transaction((tx) =>
      postOpeningStockIfNeeded(tx, org.orgId, item.id, DATE, { postGl: false }),
    );
    const after = await journalEntryCount(org.orgId);

    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(5_000_000, 2); // lot exists
    expect(after).toBe(before);                                          // no JE posted

    await cleanupOrg(org.orgId);
  });
});
