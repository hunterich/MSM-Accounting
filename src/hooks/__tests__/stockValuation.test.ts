import { describe, it, expect } from 'vitest';
import { normalizeStockValuation } from '../useInventory';

// Mirrors the real GET /api/v1/inventory/valuation payload shape.
const payload = {
    items: [
        { itemId: 'i1', sku: 'SKU-1', name: 'Widget A', categoryId: 'c1', unit: 'PCS', totalQty: 12, avgCost: 1500, totalValue: 18000 },
        { itemId: 'i2', sku: 'SKU-2', name: 'Widget B', categoryId: 'c2', unit: 'BOX', totalQty: 4,  avgCost: 2500, totalValue: 10000 },
        { itemId: 'i3', sku: 'SKU-3', name: 'No Category', categoryId: null, unit: 'PCS', totalQty: 0, avgCost: 0, totalValue: 0 },
    ],
    summary: { totalItems: 3, totalValue: 28000 },
};

const catNames = { c1: 'Raw Materials', c2: 'Finished Goods' };

describe('normalizeStockValuation', () => {
    it('maps the endpoint items[] onto rows[] and remaps field names', () => {
        const { rows } = normalizeStockValuation(payload, catNames);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            itemId: 'i1',
            sku: 'SKU-1',
            itemName: 'Widget A',      // name → itemName
            qtyOnHand: 12,             // totalQty → qtyOnHand
            avgUnitCost: 1500,         // avgCost → avgUnitCost
            totalValue: 18000,
        });
    });

    it('resolves categoryId to a category name via the lookup map', () => {
        const { rows } = normalizeStockValuation(payload, catNames);
        expect(rows[0].category).toBe('Raw Materials');
        expect(rows[1].category).toBe('Finished Goods');
        expect(rows[0].categoryId).toBe('c1');
    });

    it('falls back to an empty category for null/unknown categoryId', () => {
        const { rows } = normalizeStockValuation(payload, { c1: 'Raw Materials' });
        expect(rows[1].category).toBe('');   // c2 not in map
        expect(rows[2].category).toBe('');   // categoryId null
        expect(rows[2].categoryId).toBeUndefined();
    });

    it('pulls the grand total from summary.totalValue', () => {
        expect(normalizeStockValuation(payload, catNames).totalValue).toBe(28000);
    });

    it('omitting the category map leaves category names blank but still maps rows', () => {
        const { rows } = normalizeStockValuation(payload);
        expect(rows[0].itemName).toBe('Widget A');
        expect(rows[0].category).toBe('');
    });

    it('handles an empty/missing payload without throwing', () => {
        expect(normalizeStockValuation({ items: [], summary: { totalItems: 0, totalValue: 0 } }))
            .toEqual({ rows: [], totalValue: 0 });
        // Defensive: a malformed response should not crash the view.
        expect(normalizeStockValuation(undefined as never))
            .toEqual({ rows: [], totalValue: 0 });
    });
});
