/**
 * Overselling guard in calculateAndPostCOGS: an outbound movement that exceeds
 * on-hand stock is rejected unless the org has opted into negative stock.
 */
import { describe, expect, it, vi } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { calculateAndPostCOGS } from '../inventory-costing';

type AnyRecord = Record<string, unknown>;

/**
 * organization.findUnique is read twice (negative-stock flag + costing method);
 * returning both fields on one object satisfies either select.
 */
function makeTx(opts: {
  allowNegativeStock: boolean;
  costingMethod?: 'FIFO' | 'WEIGHTED_AVERAGE';
  lots: Array<{ id: string; qtyBalance: number; unitCost: number }>;
  itemCostPrice?: number;
}) {
  const lotRows = opts.lots.map((l) => ({ ...l, date: new Date('2026-01-01') }));
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue({
        allowNegativeStock: opts.allowNegativeStock,
        costingMethod: opts.costingMethod ?? 'FIFO',
      }),
    },
    item: {
      findUnique: vi.fn().mockResolvedValue({
        sku: 'SKU-1',
        name: 'Widget',
        costPrice: opts.itemCostPrice ?? 0,
      }),
    },
    inventoryLot: {
      findMany: vi.fn().mockResolvedValue(lotRows),
      update: vi.fn().mockResolvedValue({}),
    },
    inventoryLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
  } as AnyRecord;
}

const args = [
  'org-1',
  'item-1',
  null,
  10,
  InventoryDocumentType.SALES,
  'doc-1',
  new Date('2026-03-01'),
] as const;

describe('calculateAndPostCOGS overselling guard', () => {
  it('rejects selling more than on-hand when negative stock is disabled', async () => {
    const tx = makeTx({ allowNegativeStock: false, lots: [{ id: 'L1', qtyBalance: 4, unitCost: 100 }] });
    await expect(calculateAndPostCOGS(tx as never, ...args)).rejects.toThrow(/Insufficient stock/);
    // Nothing should have been relieved.
    expect((tx.inventoryLot as AnyRecord).update).not.toHaveBeenCalled();
    expect((tx.inventoryLedgerEntry as AnyRecord).create).not.toHaveBeenCalled();
  });

  it('allows overselling when the org opts into negative stock', async () => {
    const tx = makeTx({
      allowNegativeStock: true,
      lots: [{ id: 'L1', qtyBalance: 4, unitCost: 100 }],
      itemCostPrice: 100,
    });
    const cogs = await calculateAndPostCOGS(tx as never, ...args);
    // 4 from the lot + 6 fallback at costPrice 100 = 1000.
    expect(cogs).toBe(1000);
    expect((tx.inventoryLedgerEntry as AnyRecord).create).toHaveBeenCalledTimes(1);
  });

  it('allows a sale fully covered by stock', async () => {
    const tx = makeTx({ allowNegativeStock: false, lots: [{ id: 'L1', qtyBalance: 20, unitCost: 50 }] });
    const cogs = await calculateAndPostCOGS(tx as never, ...args);
    expect(cogs).toBe(500); // 10 × 50
  });

  it('allows overselling when the caller passes allowNegativeStock override (org flag off)', async () => {
    const tx = makeTx({ allowNegativeStock: false, lots: [{ id: 'L1', qtyBalance: 1, unitCost: 100 }] });
    await expect(
      calculateAndPostCOGS(tx as never, 'org1', 'item1', null, 5, InventoryDocumentType.SALES, 'doc1', new Date(), { allowNegativeStock: true }),
    ).resolves.toBeTypeOf('number');
  });
});
