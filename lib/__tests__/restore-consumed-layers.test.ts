/**
 * restoreConsumedLayers re-adds the stock a document drew down (un-consume): for
 * each outbound InventoryLedgerEntry the document wrote, it creates a fresh
 * inbound cost layer + ledger entry. The restored value anchors on the recorded
 * `valueChange` (exact), so the round-trip is value-neutral even when the
 * per-unit cost was rounded.
 */
import { describe, expect, it, vi } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { restoreConsumedLayers } from '../inventory-costing';

function makeTx(outbound: any[]) {
  return {
    inventoryLedgerEntry: { findMany: vi.fn(async () => outbound), create: vi.fn(async () => ({})) },
    inventoryLot: { create: vi.fn(async () => ({})) },
  };
}

const DATE = new Date('2026-06-20');

describe('restoreConsumedLayers', () => {
  it('re-adds an inbound layer per outbound entry and returns the value restored', async () => {
    const tx = makeTx([
      { itemId: 'item-1', warehouseId: null, qtyOut: 3, unitCost: 100, valueChange: -300 },
      { itemId: 'item-2', warehouseId: 'wh-1', qtyOut: 2, unitCost: 50, valueChange: -100 },
    ]);
    const restored = await restoreConsumedLayers(tx as never, 'org-a', InventoryDocumentType.SALES, 'inv-1', DATE);

    expect(tx.inventoryLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ documentType: InventoryDocumentType.SALES, documentId: 'inv-1', qtyOut: { gt: 0 } }),
      }),
    );
    const lot0 = (tx.inventoryLot.create as any).mock.calls[0][0].data;
    expect(lot0).toMatchObject({ itemId: 'item-1', warehouseId: null, documentType: 'ADJUSTMENT', qtyIn: 3, qtyOut: 0, qtyBalance: 3, unitCost: 100 });
    const led0 = (tx.inventoryLedgerEntry.create as any).mock.calls[0][0].data;
    expect(led0).toMatchObject({ itemId: 'item-1', qtyIn: 3, qtyOut: 0, valueChange: 300 });
    expect(restored).toBe(400); // 300 + 100
  });

  it('anchors restored value on the exact recorded valueChange, not qty×unitCost', async () => {
    // cogsPerUnit was rounded to 33.33 but the real total removed was 100.00.
    const tx = makeTx([
      { itemId: 'item-3', warehouseId: null, qtyOut: 3, unitCost: 33.33, valueChange: -100 },
    ]);
    const restored = await restoreConsumedLayers(tx as never, 'org-a', InventoryDocumentType.PURCHASE_RETURN, 'pr-1', DATE);

    expect(restored).toBe(100); // exact, not 99.99
    const led = (tx.inventoryLedgerEntry.create as any).mock.calls[0][0].data;
    expect(led.valueChange).toBe(100);
    const lot = (tx.inventoryLot.create as any).mock.calls[0][0].data;
    expect(lot.qtyBalance).toBe(3);
    expect(lot.unitCost).toBeCloseTo(33.3333, 3); // 100 / 3
  });

  it('is a no-op when the document consumed nothing', async () => {
    const tx = makeTx([]);
    const restored = await restoreConsumedLayers(tx as never, 'org-a', InventoryDocumentType.SALES, 'inv-1', DATE);
    expect(restored).toBe(0);
    expect(tx.inventoryLot.create).not.toHaveBeenCalled();
    expect(tx.inventoryLedgerEntry.create).not.toHaveBeenCalled();
  });
});
