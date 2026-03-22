import { describe, it, expect } from 'vitest';
import { buildProductKey, transformOrdersToInvoices } from '../shopeeImport';

// ── buildProductKey ──────────────────────────────────────────

describe('buildProductKey', () => {
    it('uses SKU when available', () => {
        const key = buildProductKey({
            parentSKU: 'SKU-001',
            skuReference: '',
            productName: 'Face Cream',
            variationName: '50ml',
        });
        expect(key).toBe('[SKU-001] Face Cream - 50ml');
    });

    it('falls back to skuReference when parentSKU is empty', () => {
        const key = buildProductKey({
            parentSKU: '',
            skuReference: 'REF-002',
            productName: 'Toner',
            variationName: '',
        });
        expect(key).toBe('[REF-002] Toner');
    });

    it('uses product name only when no SKU', () => {
        const key = buildProductKey({
            parentSKU: '',
            skuReference: '',
            productName: 'Serum',
            variationName: 'Rose',
        });
        expect(key).toBe('Serum - Rose');
    });

    it('handles missing fields gracefully', () => {
        const key = buildProductKey({});
        expect(key).toBe('');
    });
});

// ── transformOrdersToInvoices ────────────────────────────────

describe('transformOrdersToInvoices', () => {
    const sampleOrders = [
        {
            orderNumber: 'SHP-2026-001',
            orderDate: '2026-03-01',
            paymentDate: '2026-03-01',
            completionDate: '2026-03-05',
            buyerUsername: 'buyer1',
            recipientName: 'Test User',
            phone: '08123456789',
            shippingAddress: 'Jl. Sudirman No. 1',
            city: 'Jakarta',
            province: 'DKI Jakarta',
            paymentMethod: 'Bank Transfer',
            trackingNumber: 'JNE-123',
            totalPayment: 300000,
            totalProductAmount: 250000,
            items: [
                {
                    productName: 'Face Cream',
                    variationName: '50ml',
                    priceAfterDiscount: 125000,
                    quantity: 2,
                    productTotal: 250000,
                    parentSKU: 'SKU-001',
                    skuReference: '',
                    sellerDiscount: 0,
                    shopeeDiscount: 0,
                },
            ],
        },
    ];

    const baseConfig = {
        customerId: 'CUST-001',
        customerName: 'Shopee Customer',
        shopId: 'SHOP-001',
        invoiceStatus: 'Paid',
        dateField: 'completionDate',
        holdingAccount: 'BANK-001',
        itemMappings: {},
        inventoryProducts: [],
    };

    it('creates new invoices for fresh orders', () => {
        const result = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices).toHaveLength(1);
        expect(result.updatedInvoices).toHaveLength(0);
        expect(result.stats.newCount).toBe(1);
        expect(result.stats.totalAmount).toBe(250000);
    });

    it('sets invoice amount from totalProductAmount (not totalPayment)', () => {
        const result = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices[0].amount).toBe(250000);
    });

    it('generates INV/YYYY/MM/XXXXXX formatted number', () => {
        const result = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices[0].number).toMatch(/^INV\/\d{4}\/\d{2}\/\d{6}$/);
    });

    it('creates payment records when status is Paid', () => {
        const result = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.payments).toHaveLength(1);
        expect(result.payments[0].amount).toBe(250000);
        expect(result.payments[0].method).toBe('Bank Transfer');
    });

    it('skips payments when status is Unpaid', () => {
        const result = transformOrdersToInvoices(
            sampleOrders,
            { ...baseConfig, invoiceStatus: 'Unpaid' },
            [],
        );
        expect(result.payments).toHaveLength(0);
    });

    it('updates existing invoice on re-import (upsert by poNumber)', () => {
        const existingInvoices = [
            { id: 'INV-EXIST-1', number: 'INV/2026/03/000001', poNumber: 'SHP-2026-001' },
        ];
        const result = transformOrdersToInvoices(sampleOrders, baseConfig, existingInvoices);
        expect(result.newInvoices).toHaveLength(0);
        expect(result.updatedInvoices).toHaveLength(1);
        expect(result.updatedInvoices[0].id).toBe('INV-EXIST-1');
        expect(result.stats.updateCount).toBe(1);
    });

    it('applies item mappings when configured', () => {
        const config = {
            ...baseConfig,
            itemMappings: { '[SKU-001] Face Cream - 50ml': 'PROD-101' },
            inventoryProducts: [{ id: 'PROD-101', name: 'Krim Wajah 50ml' }],
        };
        const result = transformOrdersToInvoices(sampleOrders, config, []);
        const firstLine = result.newInvoices[0].items[0];
        expect(firstLine.inventoryItemId).toBe('PROD-101');
        expect(firstLine.description).toBe('Krim Wajah 50ml');
    });

    it('stores PO number as Shopee order number', () => {
        const result = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices[0].poNumber).toBe('SHP-2026-001');
    });
});
