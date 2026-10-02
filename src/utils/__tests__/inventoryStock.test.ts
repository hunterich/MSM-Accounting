import { describe, expect, it } from 'vitest';
import { stockStatusOf, productsToReorder } from '../inventoryStock';

describe('stock thresholds', () => {
    it('uses the individual minimum, including decimal quantities and the exact boundary', () => {
        expect(stockStatusOf(8, 10)).toBe('low');
        expect(stockStatusOf(3, 2)).toBe('in');
        expect(stockStatusOf(1.25, 1.5)).toBe('low');
        expect(stockStatusOf(10, 10)).toBe('in');
        expect(stockStatusOf(1, 0)).toBe('in');
        expect(stockStatusOf(0, 10)).toBe('out');
        expect(stockStatusOf(-2, 10)).toBe('out');
    });

    it('only includes active stock items below a configured minimum, most urgent first', () => {
        const base = { name: 'Product', sku: 'SKU', unit: 'PCS', type: 'PRODUCT', isActive: true, reorderPoint: 10 };
        const rows = productsToReorder([
            { ...base, id: 'low', currentStock: 6.7 },
            { ...base, id: 'out', currentStock: -1 },
            { ...base, id: 'enough', currentStock: 10 },
            { ...base, id: 'disabled', currentStock: 0, reorderPoint: 0 },
            { ...base, id: 'archived', currentStock: 0, isActive: false },
            { ...base, id: 'service', currentStock: 0, type: 'SERVICE' },
        ]);
        expect(rows.map((r) => r.id)).toEqual(['out', 'low']);
        expect(rows[0]).toMatchObject({ stockPercent: 0, shortage: 11 });
        expect(rows[1].stockPercent).toBe(67);
        expect(productsToReorder([])).toEqual([]);
    });
});
