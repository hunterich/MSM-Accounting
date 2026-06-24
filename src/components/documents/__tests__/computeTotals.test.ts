import { describe, it, expect } from 'vitest';
import { computeTotals, lineNet } from '../computeTotals';
import type { DocLine, DocCharge } from '../types';

const line = (over: Partial<DocLine> = {}): DocLine => ({
    id: 'l', code: '', description: '', qty: 1, unit: 'PCS', price: 0, discount: 0, ...over,
});

describe('lineNet', () => {
    it('multiplies qty × price', () => {
        expect(lineNet(line({ qty: 3, price: 1000 }))).toBe(3000);
    });

    it('applies a percentage discount', () => {
        expect(lineNet(line({ qty: 2, price: 1000, discount: 10 }))).toBe(1800);
    });

    it('treats missing/invalid numbers as zero', () => {
        expect(lineNet(line({ qty: NaN as unknown as number, price: 1000 }))).toBe(0);
    });
});

describe('computeTotals — tax off by default', () => {
    it('carries no tax unless turned on', () => {
        const t = computeTotals([line({ qty: 10, price: 1000 })]);
        expect(t.subtotal).toBe(10000);
        expect(t.tax).toBe(0);
        expect(t.grandTotal).toBe(10000);
    });

    it('a taxRate alone (taxOn false) still produces no tax', () => {
        const t = computeTotals([line({ qty: 10, price: 1000 })], [], { taxRate: 11 });
        expect(t.tax).toBe(0);
        expect(t.grandTotal).toBe(10000);
    });
});

describe('computeTotals — exclusive PPN (added on top)', () => {
    it('adds 11% on top of subtotal', () => {
        const t = computeTotals([line({ qty: 10, price: 1000 })], [], {
            taxOn: true, taxRate: 11, taxMode: 'exclusive',
        });
        expect(t.subtotal).toBe(10000);
        expect(t.tax).toBe(1100);
        expect(t.grandTotal).toBe(11100);
    });

    it('taxes the base net of a document discount', () => {
        const t = computeTotals([line({ qty: 10, price: 1000 })], [], {
            taxOn: true, taxRate: 11, taxMode: 'exclusive', documentDiscount: 2000,
        });
        // base = 10000 - 2000 = 8000 → tax 880 → grand 8000 + 880 = 8880
        expect(t.tax).toBe(880);
        expect(t.grandTotal).toBe(8880);
    });
});

describe('computeTotals — inclusive PPN (extracted)', () => {
    it('extracts tax from the subtotal without changing grand total', () => {
        const t = computeTotals([line({ qty: 1, price: 11100 })], [], {
            taxOn: true, taxRate: 11, taxMode: 'inclusive',
        });
        // tax = round(11100 * 11 / 111) = 1100; grand unchanged
        expect(t.tax).toBe(1100);
        expect(t.grandTotal).toBe(11100);
    });
});

describe('computeTotals — additional charges', () => {
    it('adds non-taxable charges to the grand total but not the tax base', () => {
        const charges: DocCharge[] = [
            { id: 'c1', label: 'Freight', accountId: '6310', accountLabel: '6310', amount: 5000, taxRate: 0 },
        ];
        const t = computeTotals([line({ qty: 10, price: 1000 })], charges, {
            taxOn: true, taxRate: 11, taxMode: 'exclusive',
        });
        // tax base = 10000 (freight not taxable); grand = 10000 + 5000 + 1100 = 16100
        expect(t.chargesTotal).toBe(5000);
        expect(t.tax).toBe(1100);
        expect(t.grandTotal).toBe(16100);
    });

    it('includes a taxable charge in the tax base', () => {
        const charges: DocCharge[] = [
            { id: 'c1', label: 'Handling', accountId: '6320', accountLabel: '6320', amount: 5000, taxRate: 11 },
        ];
        const t = computeTotals([line({ qty: 10, price: 1000 })], charges, {
            taxOn: true, taxRate: 11, taxMode: 'exclusive',
        });
        // tax base = 10000 + 5000 = 15000 → tax 1650; grand = 10000 + 5000 + 1650 = 16650
        expect(t.tax).toBe(1650);
        expect(t.grandTotal).toBe(16650);
    });
});

describe('computeTotals — PPh withholding', () => {
    it('deducts withholding from the payable grand total', () => {
        const t = computeTotals([line({ qty: 10, price: 1000 })], [], {
            taxOn: true, taxRate: 11, taxMode: 'exclusive', withholdingRate: 2,
        });
        // tax 1100, withholding = 2% of 10000 = 200; grand = 11100 - 200 = 10900
        expect(t.withholding).toBe(200);
        expect(t.grandTotal).toBe(10900);
    });
});
