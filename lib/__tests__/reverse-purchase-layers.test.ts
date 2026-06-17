/**
 * reversePurchaseLayers removes the unconsumed PURCHASE cost layers a document
 * created, writes a contra ledger entry for audit, and refuses if any layer has
 * already been drawn down (consumed/sold).
 */
import { describe, expect, it, vi } from 'vitest';
import { reversePurchaseLayers } from '../inventory-costing';

function makeTx(lots: any[]) {
  return {
    inventoryLot: {
      findMany: vi.fn(async () => lots),
      delete: vi.fn(async () => ({})),
    },
    inventoryLedgerEntry: { create: vi.fn(async () => ({})) },
  };
}

const DATE = new Date('2026-06-14');

describe('reversePurchaseLayers', () => {
  it('deletes unconsumed layers, appends contra ledger entries, and returns the value removed', async () => {
    const tx = makeTx([
      { id: 'lot-1', itemId: 'item-1', warehouseId: null, qtyIn: 10, qtyOut: 0, qtyBalance: 10, unitCost: 1000 },
      { id: 'lot-2', itemId: 'item-2', warehouseId: null, qtyIn: 4, qtyOut: 0, qtyBalance: 4, unitCost: 250 },
    ]);
    const removed = await reversePurchaseLayers(tx as never, 'org-a', 'bill-1', DATE);

    expect(tx.inventoryLot.delete).toHaveBeenCalledWith({ where: { id: 'lot-1' } });
    const led = (tx.inventoryLedgerEntry.create as any).mock.calls[0][0].data;
    expect(led.qtyOut).toBe(10);
    expect(led.valueChange).toBe(-10000);
    expect(led.documentId).toBe('bill-1');
    expect(removed).toBe(11000); // 10×1000 + 4×250
  });

  it('throws and deletes nothing when a layer has been consumed', async () => {
    const tx = makeTx([
      { id: 'lot-1', itemId: 'item-1', warehouseId: null, qtyIn: 10, qtyOut: 4, qtyBalance: 6, unitCost: 1000 },
    ]);
    await expect(reversePurchaseLayers(tx as never, 'org-a', 'bill-1', DATE)).rejects.toThrow(/consumed|sold/i);
    expect(tx.inventoryLot.delete).not.toHaveBeenCalled();
    expect(tx.inventoryLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('is a no-op when the document created no layers', async () => {
    const tx = makeTx([]);
    await reversePurchaseLayers(tx as never, 'org-a', 'bill-1', DATE);
    expect(tx.inventoryLot.delete).not.toHaveBeenCalled();
    expect(tx.inventoryLedgerEntry.create).not.toHaveBeenCalled();
  });
});
