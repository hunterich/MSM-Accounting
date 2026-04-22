import { describe, it, expect } from 'vitest';
import {
    buildProductKey,
    transformOrdersToInvoices,
    normalizeHeader,
    resolveHeaders,
} from '../shopeeImport';
import type {
    ParsedShopeeOrder,
    TransformConfig,
    TransformResult,
} from '../shopeeImport';

// ── buildProductKey ──────────────────────────────────────────

describe('buildProductKey', () => {
    it('uses SKU when available', () => {
        const key: string = buildProductKey({
            parentSKU: 'SKU-001',
            skuReference: '',
            productName: 'Face Cream',
            variationName: '50ml',
        });
        expect(key).toBe('[SKU-001] Face Cream - 50ml');
    });

    it('falls back to skuReference when parentSKU is empty', () => {
        const key: string = buildProductKey({
            parentSKU: '',
            skuReference: 'REF-002',
            productName: 'Toner',
            variationName: '',
        });
        expect(key).toBe('[REF-002] Toner');
    });

    it('uses product name only when no SKU', () => {
        const key: string = buildProductKey({
            parentSKU: '',
            skuReference: '',
            productName: 'Serum',
            variationName: 'Rose',
        });
        expect(key).toBe('Serum - Rose');
    });

    it('handles missing fields gracefully', () => {
        // The function accepts Pick<ShopeeLineItem, ...> — pass an empty-ish object
        const key: string = buildProductKey({
            parentSKU: '',
            skuReference: '',
            productName: '',
            variationName: '',
        });
        expect(key).toBe('');
    });
});

// ── transformOrdersToInvoices ────────────────────────────────

describe('transformOrdersToInvoices', () => {
    const sampleOrders: ParsedShopeeOrder[] = [
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

    const baseConfig: TransformConfig = {
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
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices).toHaveLength(1);
        expect(result.updatedInvoices).toHaveLength(0);
        expect(result.stats.newCount).toBe(1);
        expect(result.stats.totalAmount).toBe(250000);
    });

    it('sets invoice amount from totalProductAmount (not totalPayment)', () => {
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices[0].amount).toBe(250000);
    });

    it('generates INV/YYYY/MM/XXXXXX formatted number', () => {
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices[0].number).toMatch(/^INV\/\d{4}\/\d{2}\/\d{6}$/);
    });

    it('creates payment records when status is Paid', () => {
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.payments).toHaveLength(1);
        expect(result.payments[0].amount).toBe(250000);
        expect(result.payments[0].method).toBe('Bank Transfer');
    });

    it('skips payments when status is Unpaid', () => {
        const result: TransformResult = transformOrdersToInvoices(
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
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, baseConfig, existingInvoices);
        expect(result.newInvoices).toHaveLength(0);
        expect(result.updatedInvoices).toHaveLength(1);
        expect(result.updatedInvoices[0].id).toBe('INV-EXIST-1');
        expect(result.stats.updateCount).toBe(1);
    });

    it('applies item mappings when configured', () => {
        const config: TransformConfig = {
            ...baseConfig,
            itemMappings: { '[SKU-001] Face Cream - 50ml': 'PROD-101' },
            inventoryProducts: [{ id: 'PROD-101', name: 'Krim Wajah 50ml' }],
        };
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, config, []);
        const firstLine = result.newInvoices[0].items[0];
        expect(firstLine.inventoryItemId).toBe('PROD-101');
        expect(firstLine.description).toBe('Krim Wajah 50ml');
    });

    it('stores PO number as Shopee order number', () => {
        const result: TransformResult = transformOrdersToInvoices(sampleOrders, baseConfig, []);
        expect(result.newInvoices[0].poNumber).toBe('SHP-2026-001');
    });
});

// ── normalizeHeader ──────────────────────────────────────────

describe('normalizeHeader', () => {
    it('lowercases and strips punctuation', () => {
        expect(normalizeHeader('No. Pesanan')).toBe('nopesanan');
    });

    it('collapses whitespace and dashes', () => {
        expect(normalizeHeader('No   Pesanan')).toBe('nopesanan');
        expect(normalizeHeader('NO-PESANAN')).toBe('nopesanan');
    });

    it('strips parentheses', () => {
        expect(normalizeHeader('Username (Pembeli)')).toBe('usernamepembeli');
    });

    it('treats slash-separated words as one token', () => {
        expect(normalizeHeader('Kota/Kabupaten')).toBe('kotakabupaten');
    });

    it('returns empty for nullish', () => {
        expect(normalizeHeader('')).toBe('');
        // @ts-expect-error intentional null test
        expect(normalizeHeader(null)).toBe('');
    });
});

// ── resolveHeaders ───────────────────────────────────────────

describe('resolveHeaders', () => {
    it('resolves canonical Shopee headers exactly', () => {
        const result = resolveHeaders([
            'No. Pesanan', 'Nama Produk', 'Total Harga Produk', 'Status Pesanan',
        ]);
        expect(result.missingRequired).toHaveLength(0);
        expect(result.resolvedHeaders.orderNumber).toBe('No. Pesanan');
        expect(result.resolvedHeaders.productName).toBe('Nama Produk');
        expect(result.resolvedHeaders.productTotal).toBe('Total Harga Produk');
        expect(result.resolvedHeaders.orderStatus).toBe('Status Pesanan');
    });

    it('matches headers with different punctuation and casing', () => {
        const result = resolveHeaders([
            'no pesanan', 'NAMA PRODUK', 'total-harga-produk',
        ]);
        expect(result.missingRequired).toHaveLength(0);
        expect(result.resolvedHeaders.orderNumber).toBe('no pesanan');
    });

    it('uses aliases when Shopee renames a column', () => {
        const result = resolveHeaders([
            'Nomor Pesanan', 'Product Name', 'Product Total',
        ]);
        expect(result.missingRequired).toHaveLength(0);
        expect(result.resolvedHeaders.orderNumber).toBe('Nomor Pesanan');
        expect(result.resolvedHeaders.productName).toBe('Product Name');
    });

    it('reports missing required columns', () => {
        const result = resolveHeaders(['Nama Produk', 'Status Pesanan']);
        const missingKeys = result.missingRequired.map((m) => m.internalKey);
        expect(missingKeys).toContain('orderNumber');
        expect(missingKeys).toContain('productTotal');
        expect(missingKeys).not.toContain('productName');
    });

    it('reports optional missing columns without blocking', () => {
        const result = resolveHeaders([
            'No. Pesanan', 'Nama Produk', 'Total Harga Produk',
        ]);
        expect(result.missingRequired).toHaveLength(0);
        const optionalKeys = result.missingOptional.map((m) => m.internalKey);
        expect(optionalKeys).toContain('orderStatus');
        expect(optionalKeys).toContain('quantity');
    });

    it('reports unknown headers found in file', () => {
        const result = resolveHeaders([
            'No. Pesanan', 'Nama Produk', 'Total Harga Produk', 'Some Future Column',
        ]);
        expect(result.unknownHeaders).toContain('Some Future Column');
    });

    it('preserves the actual header string (not the alias) in resolvedHeaders', () => {
        const result = resolveHeaders(['no. pesanan!', 'Nama Produk', 'Total Harga Produk']);
        expect(result.resolvedHeaders.orderNumber).toBe('no. pesanan!');
    });
});
