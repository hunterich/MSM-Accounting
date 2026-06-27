import { describe, it, expect } from 'vitest';
import { mapStockValuationResponse } from '../useInventory';

describe('mapStockValuationResponse', () => {
  it('maps the endpoint { items, summary } shape to { rows, totalValue }', () => {
    const result = mapStockValuationResponse({
      items: [
        { itemId: 'i1', sku: 'SKU-1', name: 'Widget', categoryId: 'cat-1', unit: 'pcs', totalQty: 10, avgCost: 2500, totalValue: 25000 },
      ],
      summary: { totalItems: 1, totalValue: 25000 },
    });

    expect(result.totalValue).toBe(25000);
    expect(result.rows).toHaveLength(1);
    // Field remapping: name→itemName, totalQty→qtyOnHand, avgCost→avgUnitCost.
    expect(result.rows[0]).toMatchObject({
      itemId: 'i1',
      sku: 'SKU-1',
      itemName: 'Widget',
      categoryId: 'cat-1',
      qtyOnHand: 10,
      avgUnitCost: 2500,
      totalValue: 25000,
    });
  });

  it('coerces decimal strings to numbers', () => {
    const result = mapStockValuationResponse({
      items: [
        { itemId: 'i2', sku: 'SKU-2', name: 'Gadget', categoryId: null, unit: 'pcs', totalQty: '3.5', avgCost: '1000.50', totalValue: '3501.75' },
      ],
      summary: { totalItems: 1, totalValue: '3501.75' },
    });

    expect(result.rows[0].qtyOnHand).toBe(3.5);
    expect(result.rows[0].avgUnitCost).toBe(1000.5);
    expect(result.rows[0].totalValue).toBe(3501.75);
    expect(result.rows[0].categoryId).toBeUndefined();
    expect(result.totalValue).toBe(3501.75);
  });

  it('returns empty rows and zero total for an empty payload', () => {
    expect(mapStockValuationResponse({ items: [], summary: { totalItems: 0, totalValue: 0 } }))
      .toEqual({ rows: [], totalValue: 0 });
  });
});
