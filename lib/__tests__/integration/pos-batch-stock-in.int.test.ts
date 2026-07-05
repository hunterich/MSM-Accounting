import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, assertTrialBalanced, cleanupOrg, disconnect, TOLERANCE } from './harness';
import { receiveBatch } from '@/lib/pos/batch-stock-in';

afterAll(async () => {
  await disconnect();
});

describe('receiveBatch', () => {
  it('creates a StockBatch, adds inventory value, and keeps the trial balance balanced', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const item = await prisma.item.create({
      data: { organizationId: org.orgId, sku: `SKU-${Date.now()}`, name: 'Amoxicillin 500mg', type: 'PRODUCT', requiresBatchTracking: true, drugClass: 'OBAT_KERAS' },
      select: { id: true },
    });

    const batchId = await prisma.$transaction((tx) =>
      receiveBatch(tx, org.orgId, {
        itemId: item.id,
        warehouseId: org.warehouseId,
        batchNumber: 'AMX-2609',
        expiryDate: new Date('2027-09-01'),
        qty: 100,
        unitCost: 2000,
        date: new Date('2026-07-03'),
      }),
    );

    const batch = await prisma.stockBatch.findUnique({ where: { id: batchId }, select: { qtyOnHand: true } });
    expect(Number(batch?.qtyOnHand)).toBe(100);

    const ledgerCount = await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId, itemId: item.id } });
    expect(ledgerCount).toBeGreaterThan(0);

    const report = await assertTrialBalanced(org.orgId, 'batch stock-in');
    expect(report.summary.endingDebit).toBeCloseTo(report.summary.endingCredit, TOLERANCE);

    await cleanupOrg(org.orgId);
  });
});
