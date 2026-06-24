/**
 * Integration: CSV item import posts opening stock correctly.
 *
 * Asserts that an item created via the CSV import route (which now calls
 * postOpeningStockIfNeeded) ends up identical to an item created via the normal
 * UI route:
 *   - an InventoryLot exists (on-hand qty is visible)
 *   - a balanced DR Inventory / CR Opening Balance Equity journal entry is posted
 *   - the trial balance holds
 *
 * We test the lib function directly (same approach as other int tests) rather
 * than spinning up the HTTP route, because the HTTP layer just wires the same
 * two pieces together.
 *
 * Run with: npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { postOpeningStockIfNeeded } from '../../inventory-opening';
import {
  prisma,
  createTestOrg,
  assertTrialBalanced,
  accountBalance,
  inventoryLedgerValue,
  inventoryLotValue,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-01-01T00:00:00.000Z');

describe('CSV item import: opening stock posting', () => {
  it('creates an InventoryLot + balanced opening JE, matching normal item-route behaviour', async () => {
    const org = await createTestOrg();

    // Simulate what the CSV import route does: create an item (no lot yet)
    // then call postOpeningStockIfNeeded inside the same transaction.
    const unitCost = 7_000_000;   // Rp 7 jt per unit
    const qty = 25;
    const totalValue = unitCost * qty; // Rp 175 jt

    const importDate = DATE;
    let itemId: string;

    await prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          organizationId: org.orgId,
          sku: 'LAP-ASUS-001',
          name: 'Laptop Asus VivoBook',
          type: 'PRODUCT',
          unit: 'PCS',
          sellingPrice: 8_500_000,
          costPrice: unitCost,
          openingStock: qty,
        },
      });
      itemId = item.id;
      await postOpeningStockIfNeeded(tx, org.orgId, item.id, importDate);
    });

    // 1. InventoryLot must exist for the item.
    const lots = await prisma.inventoryLot.findMany({
      where: { organizationId: org.orgId, itemId: itemId! },
      select: { qtyBalance: true, unitCost: true },
    });
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].qtyBalance)).toBeCloseTo(qty, 2);
    expect(Number(lots[0].unitCost)).toBeCloseTo(unitCost, 2);

    // 2. InventoryLedgerEntry of type OPENING must exist.
    const ledgerEntry = await prisma.inventoryLedgerEntry.findFirst({
      where: { organizationId: org.orgId, itemId: itemId!, documentType: InventoryDocumentType.OPENING },
      select: { id: true },
    });
    expect(ledgerEntry).not.toBeNull();

    // 3. On-hand value from lots must match the ledger value.
    const lotVal = await inventoryLotValue(org.orgId);
    const ledgerVal = await inventoryLedgerValue(org.orgId);
    expect(lotVal).toBeCloseTo(totalValue, 2);
    expect(ledgerVal).toBeCloseTo(totalValue, 2);

    // 4. Inventory GL account balance must equal the lot/ledger value.
    const glBal = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(glBal).toBeCloseTo(totalValue, 2);

    // 5. Opening Balance Equity account must be credited the same amount.
    const equityBal = await accountBalance(org.orgId, org.accounts.openingBalanceEquity);
    // Credit-normal: debit-positive net balance is negative.
    expect(equityBal).toBeCloseTo(-totalValue, 2);

    // 6. Full trial balance holds.
    await assertTrialBalanced(org.orgId, 'csv import opening stock');

    await cleanupOrg(org.orgId);
  });

  it('is idempotent — calling postOpeningStockIfNeeded twice for the same item posts only one JE', async () => {
    const org = await createTestOrg();

    let itemId: string;
    await prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          organizationId: org.orgId,
          sku: 'WIDGET-001',
          name: 'Test Widget',
          type: 'PRODUCT',
          costPrice: 500,
          openingStock: 10,
        },
      });
      itemId = item.id;
      await postOpeningStockIfNeeded(tx, org.orgId, item.id, DATE);
    });

    // Second call (simulates a re-import or double-trigger) — must be a no-op.
    await prisma.$transaction(async (tx) => {
      await postOpeningStockIfNeeded(tx, org.orgId, itemId!, DATE);
    });

    const lots = await prisma.inventoryLot.findMany({
      where: { organizationId: org.orgId, itemId: itemId! },
    });
    expect(lots).toHaveLength(1);

    const entries = await prisma.journalEntry.findMany({
      where: { organizationId: org.orgId },
    });
    expect(entries).toHaveLength(1);

    await assertTrialBalanced(org.orgId, 'idempotent opening stock');
    await cleanupOrg(org.orgId);
  });

  it('skips posting when openingStock is 0 (no lot, no JE)', async () => {
    const org = await createTestOrg();

    await prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          organizationId: org.orgId,
          sku: 'SVC-001',
          name: 'Consulting Service',
          type: 'SERVICE',
          costPrice: 100_000,
          openingStock: 0,
        },
      });
      // The CSV import route only calls postOpeningStockIfNeeded when openingStock > 0,
      // but calling it on a 0-stock item must still be a no-op.
      await postOpeningStockIfNeeded(tx, org.orgId, item.id, DATE);
    });

    const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } });
    const entries = await prisma.journalEntry.findMany({ where: { organizationId: org.orgId } });
    expect(lots).toHaveLength(0);
    expect(entries).toHaveLength(0);

    await cleanupOrg(org.orgId);
  });
});
