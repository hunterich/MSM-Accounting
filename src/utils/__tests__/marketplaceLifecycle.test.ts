import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseShopeeExcel } from '../shopeeImport';
import { isMarketplaceReversalStatus } from '../marketplaceLifecycle';

describe('shipment-date marketplace imports', () => {
    it('keeps month-one shipments before month-two completion and excludes unshipped orders', async () => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
            { 'Order ID': '1001', 'Order Status': 'Shipped', 'Product Name': 'Product', 'SKU Subtotal After Discount': 100, 'Shipped Time': '2026-01-31', 'Delivered Time': '2026-02-03' },
            { 'Order ID': '1002', 'Order Status': 'To ship', 'Product Name': 'Product', 'SKU Subtotal After Discount': 100 },
            { 'Order ID': '1003', 'Order Status': 'Canceled', 'Product Name': 'Product', 'SKU Subtotal After Discount': 100 },
        ]), 'Orders');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const parsed = await parseShopeeExcel({ arrayBuffer: async () => buffer } as File, 'Shipped', 'TikTok');
        expect(parsed.parsedOrders.map(o => o.orderNumber)).toEqual(['1001', '1003']);
        expect(parsed.parsedOrders[0].shipmentDate).toBe('2026-01-31');
        expect(parsed.parsedOrders[0].completionDate).toBe('2026-02-03');
        expect(parsed.parsedOrders[1].orderStatus).toBe('Canceled');
    });
    it('does not mistake a delivered-order return window for an actual return', () => {
        expect(isMarketplaceReversalStatus('Pesanan diterima, namun Pembeli masih dapat mengajukan pengembalian')).toBe(false);
        expect(isMarketplaceReversalStatus('Dibatalkan')).toBe(true);
        expect(isMarketplaceReversalStatus('Returned')).toBe(true);
    });
});
