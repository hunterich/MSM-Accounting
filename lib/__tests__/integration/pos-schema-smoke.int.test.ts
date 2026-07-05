import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => {
  await disconnect();
});

describe('POS schema smoke', () => {
  it('creates a StockBatch scoped to the org', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const item = await prisma.item.create({
      data: {
        organizationId: org.orgId,
        sku: `SKU-${Date.now()}`,
        name: 'Paracetamol 500mg',
        type: 'PRODUCT',
        requiresBatchTracking: true,
        drugClass: 'OBAT_BEBAS',
      },
      select: { id: true },
    });
    const batch = await prisma.stockBatch.create({
      data: {
        organizationId: org.orgId,
        itemId: item.id,
        warehouseId: org.warehouseId,
        batchNumber: 'B-001',
        expiryDate: new Date('2027-01-01'),
        qtyOnHand: 100,
        unitCost: 1500,
      },
      select: { id: true, qtyOnHand: true },
    });
    expect(batch.id).toBeTruthy();
    expect(Number(batch.qtyOnHand)).toBe(100);
    await cleanupOrg(org.orgId);
  });
});
