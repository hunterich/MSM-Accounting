import { describe, it, expect } from 'vitest';
import {
    salesOrderAmount,
    titleCaseStatus,
    toSalesOrderLines,
    toSalesOrderView,
} from '../salesOrderView';
import { computeTotals } from '../../components/documents/computeTotals';
import type { SalesOrder, SalesOrderItem } from '../../types';

const item = (over: Partial<SalesOrderItem> = {}): SalesOrderItem => ({
    id: 'li-1',
    productId: 'p1',
    code: 'SKU-1',
    description: 'Widget A',
    quantity: 10,
    unit: 'PCS',
    price: 500_000,
    discount: 0,
    ...over,
});

const order = (over: Partial<SalesOrder> = {}): SalesOrder => ({
    id: 'cku12345',
    number: 'SO-2026-0001',
    customerId: 'cus1',
    customerName: 'PT Sinar Jaya',
    issueDate: '2026-03-01',
    expiryDate: '2026-03-15',
    status: 'draft' as SalesOrder['status'],
    notes: '',
    invoiceId: null,
    items: [item()],
    ...over,
});

describe('salesOrderAmount', () => {
    it('sums qty x price', () => {
        expect(salesOrderAmount([item({ quantity: 2, price: 100 }), item({ quantity: 3, price: 100 })])).toBe(500);
    });

    it('applies the per-line discount as a percentage', () => {
        expect(salesOrderAmount([item({ quantity: 2, price: 1000, discount: 10 })])).toBe(1800);
    });

    it('is zero for an order with no items', () => {
        expect(salesOrderAmount([])).toBe(0);
        expect(salesOrderAmount()).toBe(0);
    });

    /**
     * The list total and the form total must be the same number, or the same
     * order reads differently depending on which screen you are looking at.
     */
    it('matches computeTotals subtotal, which is what the SO form shows', () => {
        const items = [
            item({ quantity: 3, price: 1_250_000, discount: 5 }),
            item({ id: 'li-2', quantity: 1, price: 200_000, discount: 0 }),
        ];
        const viaComputeTotals = computeTotals(
            items.map((i) => ({ qty: i.quantity, price: i.price, discount: i.discount })) as never,
            [],
        );
        expect(salesOrderAmount(items)).toBeCloseTo(viaComputeTotals.subtotal, 6);
    });
});

describe('titleCaseStatus', () => {
    it('normalizes the API casing to what the panes compare against', () => {
        expect(titleCaseStatus('draft')).toBe('Draft');
        expect(titleCaseStatus('CONFIRMED')).toBe('Confirmed');
        expect(titleCaseStatus('Delivered')).toBe('Delivered');
    });

    it('returns an empty string rather than inventing a status', () => {
        expect(titleCaseStatus('')).toBe('');
        expect(titleCaseStatus(null)).toBe('');
        expect(titleCaseStatus(undefined)).toBe('');
    });
});

describe('toSalesOrderLines', () => {
    it('renames quantity to the qty the panes and print templates read', () => {
        const [line] = toSalesOrderLines(order({ items: [item({ quantity: 7 })] }));
        expect(line.qty).toBe(7);
    });

    it('falls back to PCS for a unit the API left null', () => {
        const [line] = toSalesOrderLines(order({ items: [item({ unit: '' })] }));
        expect(line.unit).toBe('PCS');
    });

    it('gives every line a key even when the API sends none', () => {
        const lines = toSalesOrderLines(order({ items: [item({ id: undefined }), item({ id: undefined, code: 'SKU-2' })] }));
        expect(new Set(lines.map((l) => l.id)).size).toBe(2);
    });

    it('is empty for a missing order rather than throwing', () => {
        expect(toSalesOrderLines(null)).toEqual([]);
        expect(toSalesOrderLines(undefined)).toEqual([]);
    });
});

describe('toSalesOrderView', () => {
    it('keeps the cuid as id and the number as the display label', () => {
        const view = toSalesOrderView(order());
        expect(view.id).toBe('cku12345');
        expect(view.no).toBe('SO-2026-0001');
    });

    it('falls back to the id when the order has no number yet', () => {
        expect(toSalesOrderView(order({ number: '' })).no).toBe('cku12345');
    });

    it('maps the API date fields onto the ones the panes render', () => {
        const view = toSalesOrderView(order());
        expect(view.date).toBe('2026-03-01');
        expect(view.expectedDate).toBe('2026-03-15');
    });

    it('carries the linked invoice through under the name the panes use', () => {
        expect(toSalesOrderView(order({ invoiceId: 'inv1' })).convertedInvoiceId).toBe('inv1');
        expect(toSalesOrderView(order()).convertedInvoiceId).toBeNull();
    });

    it('derives the amount from the lines, since the SO has no total column', () => {
        expect(toSalesOrderView(order({ items: [item({ quantity: 2, price: 750_000 })] })).amount).toBe(1_500_000);
    });
});
