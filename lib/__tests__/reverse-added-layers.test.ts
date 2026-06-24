/**
 * reverseAddedLayers generalizes reversePurchaseLayers to any documentType: it
 * removes the unconsumed inbound cost layers a document created (blocking if any
 * was drawn down), appends contra ledger entries, and returns the value removed.
 * reversePurchaseLayers remains as a PURCHASE-typed wrapper.
 */
import { describe, expect, it, vi } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { reverseAddedLayers, reversePurchaseLayers } from '../inventory-costing';

function makeTx(lots: any[]) {
  return {
    inventoryLot: {
      findMany: vi.fn(async () => lots),
      delete: vi.fn(async () => ({})),
    },
    inventoryLedgerEntry: { create: vi.fn(async () => ({})) },
  };
}

const DATE = new Date('2026-06-20');

describe('reverseAddedLayers', () => {
  it('filters lots by the given documentType and removes unconsumed layers', async () => {
    const tx = makeTx([
      { id: 'lot-1', itemId: 'item-1', warehouseId: null, qtyIn: 5, qtyOut: 0, qtyBalance: 5, unitCost: 200 },
    ]);
    const removed = await reverseAddedLayers(tx as never, 'org-a', InventoryDocumentType.SALES_RETURN, 'sr-1', DATE);

    expect(tx.inventoryLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ documentType: InventoryDocumentType.SALES_RETURN, documentId: 'sr-1' }),
      }),
    );
    expect(tx.inventoryLot.delete).toHaveBeenCalledWith({ where: { id: 'lot-1' } });
    const led = (tx.inventoryLedgerEntry.create as any).mock.calls[0][0].data;
    expect(led.qtyOut).toBe(5);
    expect(led.valueChange).toBe(-1000);
    expect(removed).toBe(1000); // 5×200
  });

  it('throws and deletes nothing when a layer has been drawn down', async () => {
    const tx = makeTx([
      { id: 'lot-1', itemId: 'item-1', warehouseId: null, qtyIn: 5, qtyOut: 2, qtyBalance: 3, unitCost: 200 },
    ]);
    await expect(
      reverseAddedLayers(tx as never, 'org-a', InventoryDocumentType.SALES_RETURN, 'sr-1', DATE),
    ).rejects.toThrow(/consumed|sold/i);
    expect(tx.inventoryLot.delete).not.toHaveBeenCalled();
    expect(tx.inventoryLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('reversePurchaseLayers still delegates with documentType PURCHASE', async () => {
    const tx = makeTx([
      { id: 'lot-1', itemId: 'item-1', warehouseId: null, qtyIn: 1, qtyOut: 0, qtyBalance: 1, unitCost: 100 },
    ]);
    await reversePurchaseLayers(tx as never, 'org-a', 'bill-1', DATE);
    expect(tx.inventoryLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ documentType: InventoryDocumentType.PURCHASE, documentId: 'bill-1' }),
      }),
    );
  });
});
