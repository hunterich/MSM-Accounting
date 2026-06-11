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

// ── TikTok Shop export support ───────────────────────────────

import * as XLSX from 'xlsx';
import { parseShopeeExcel } from '../shopeeImport';

/** Headers as they appear in a real TikTok Shop "Semua pesanan" export. */
const TIKTOK_HEADERS = [
    'Order ID', 'Order Status', 'Order Substatus', 'Seller SKU', 'Product Name',
    'Variation', 'Quantity', 'SKU Unit Original Price', 'SKU Subtotal After Discount',
    'SKU Seller Discount', 'SKU Platform Discount', 'Shipping Fee After Discount',
    'Order Amount', 'Created Time', 'Paid Time', 'Delivered Time', 'Tracking ID',
    'Buyer Username', 'Recipient', 'Phone #', 'Detail Address', 'Regency and City',
    'Province', 'Payment Method',
];

function buildTikTokFile(rows: unknown[][]): File {
    const ws = XLSX.utils.aoa_to_sheet([TIKTOK_HEADERS, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OrderSKUList');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return new File([buf], 'tiktok-orders.xlsx');
}

const tiktokRow = (overrides: Record<string, unknown> = {}): unknown[] => {
    const base: Record<string, unknown> = {
        'Order ID': '583622661095589262',
        'Order Status': 'Selesai',
        'Order Substatus': 'Selesai',
        'Seller SKU': 'CC246A',
        'Product Name': 'Cultusia True Color Shampo Gray',
        'Variation': 'shp grey',
        'Quantity': '1',
        'SKU Unit Original Price': '42000',
        'SKU Subtotal After Discount': '34200',
        'SKU Seller Discount': '7800',
        'SKU Platform Discount': '0',
        'Shipping Fee After Discount': '1000',
        'Order Amount': '35200',
        'Created Time': '21/04/2026 00:59:27',
        'Paid Time': '21/04/2026 00:59:59',
        'Delivered Time': '24/04/2026 10:00:00',
        'Tracking ID': 'JX1234567890',
        'Buyer Username': 'c***pliss',
        'Recipient': 'A***** S*******',
        'Phone #': '(+62)812****1234',
        'Detail Address': 'Jl. Mawar No. 1',
        'Regency and City': 'Kota Surabaya',
        'Province': 'Jawa Timur',
        'Payment Method': 'DANA',
        ...overrides,
    };
    return TIKTOK_HEADERS.map((h) => base[h] ?? '');
};

/** TikTok puts a field-description row directly under the header. */
const descriptionRow = (): unknown[] =>
    tiktokRow({
        'Order ID': 'Platform unique order ID.',
        'Order Status': 'Current order status.',
        'Quantity': 'SKU sold quantity in the order.',
        'SKU Subtotal After Discount': 'It equals SKU Subtotal Before Discount minus discounts.',
        'Created Time': 'Order created time.',
    });

describe('TikTok Shop export parsing', () => {
    it('resolves TikTok English headers onto the same internal keys', () => {
        const result = resolveHeaders(TIKTOK_HEADERS);
        expect(result.missingRequired).toHaveLength(0);
        expect(result.resolvedHeaders.orderNumber).toBe('Order ID');
        expect(result.resolvedHeaders.productTotal).toBe('SKU Subtotal After Discount');
        expect(result.resolvedHeaders.parentSKU).toBe('Seller SKU');
        expect(result.resolvedHeaders.trackingNumber).toBe('Tracking ID');
        expect(result.resolvedHeaders.totalPayment).toBe('Order Amount');
        expect(result.resolvedHeaders.phone).toBe('Phone #');
        expect(result.resolvedHeaders.orderCompletedTime).toBe('Delivered Time');
    });

    it('skips the description row and parses real orders', async () => {
        const file = buildTikTokFile([descriptionRow(), tiktokRow()]);
        const result = await parseShopeeExcel(file, 'Selesai');
        expect(result.parsedOrders).toHaveLength(1);
        const order = result.parsedOrders[0];
        expect(order.orderNumber).toBe('583622661095589262');
        expect(order.totalProductAmount).toBe(34200);
        expect(order.orderDate).toBe('2026-04-21');
        expect(order.completionDate).toBe('2026-04-24');
        expect(order.trackingNumber).toBe('JX1234567890');
    });

    it('filters out Dibatalkan orders with the default Selesai filter', async () => {
        const file = buildTikTokFile([
            descriptionRow(),
            tiktokRow(),
            tiktokRow({ 'Order ID': '583620534579726242', 'Order Status': 'Dibatalkan' }),
        ]);
        const result = await parseShopeeExcel(file, 'Selesai');
        expect(result.parsedOrders).toHaveLength(1);
        expect(result.stats.skippedRows).toBe(1);
    });

    it('derives unit price from SKU subtotal when no after-discount price column exists', async () => {
        const file = buildTikTokFile([
            descriptionRow(),
            tiktokRow({ 'Quantity': '3', 'SKU Subtotal After Discount': '102600' }),
        ]);
        const result = await parseShopeeExcel(file, 'Selesai');
        const item = result.parsedOrders[0].items[0];
        expect(item.quantity).toBe(3);
        expect(item.productTotal).toBe(102600);
        expect(item.priceAfterDiscount).toBe(34200);
    });

    it('groups multiple SKU rows of one order into a single order', async () => {
        const file = buildTikTokFile([
            descriptionRow(),
            tiktokRow(),
            tiktokRow({ 'Seller SKU': 'CC247B', 'Product Name': 'Cultusia Serum', 'SKU Subtotal After Discount': '50000' }),
        ]);
        const result = await parseShopeeExcel(file, 'Selesai');
        expect(result.parsedOrders).toHaveLength(1);
        expect(result.parsedOrders[0].items).toHaveLength(2);
        expect(result.parsedOrders[0].totalProductAmount).toBe(84200);
    });

    it('stamps the configured platform into notes and audit', () => {
        const orders: ParsedShopeeOrder[] = [{
            orderNumber: '583622661095589262',
            orderDate: '2026-04-21', paymentDate: '2026-04-21', completionDate: '2026-04-24',
            buyerUsername: 'c***pliss', recipientName: 'A S', phone: '0812', shippingAddress: 'Jl. Mawar',
            city: 'Surabaya', province: 'Jawa Timur', paymentMethod: 'DANA', trackingNumber: 'JX1',
            totalPayment: 35200, totalProductAmount: 34200,
            items: [{ productName: 'Shampo', variationName: '', priceAfterDiscount: 34200, quantity: 1, productTotal: 34200, parentSKU: 'CC246A', skuReference: '', sellerDiscount: 0, shopeeDiscount: 0 }],
        }];
        const result = transformOrdersToInvoices(orders, {
            customerId: 'CUST-TT', customerName: 'TikTok Sales', shopId: 'SHOP-002', platform: 'TikTok',
        }, []);
        expect(result.newInvoices[0].notes).toMatch(/^TikTok \|/);
        expect(result.newInvoices[0].audit[0].action).toBe('Created (TikTok Import)');
        expect(result.payments[0].method).toBe('E-Wallet');
    });

    it('maps "Bayar di tempat" (TikTok COD) to COD', () => {
        const orders: ParsedShopeeOrder[] = [{
            orderNumber: '583375886106133963',
            orderDate: '2026-04-08', paymentDate: '2026-04-08', completionDate: '2026-04-08',
            buyerUsername: 'b', recipientName: 'r', phone: '', shippingAddress: '',
            city: '', province: '', paymentMethod: 'Bayar di tempat', trackingNumber: 'JX1',
            totalPayment: 35848, totalProductAmount: 34493,
            items: [{ productName: 'Shampo', variationName: '', priceAfterDiscount: 34493, quantity: 1, productTotal: 34493, parentSKU: 'CC247A', skuReference: '', sellerDiscount: 0, shopeeDiscount: 0 }],
        }];
        const result = transformOrdersToInvoices(orders, {
            customerId: 'C', customerName: 'TikTok Sales', shopId: 'S', platform: 'TikTok',
        }, []);
        expect(result.payments[0].method).toBe('COD');
    });
});
