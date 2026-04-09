import { describe, expect, it } from 'vitest';
import { analyzeBillImportText, normalizeSupplierLabel } from '../bill-imports';

const baseVendors = [
  { id: 'vendor-1', name: 'PT Supplier Sejahtera', npwp: '01.234.567.8-999.000' },
];

const baseItems = [
  { id: 'item-1', sku: 'SKU-001', name: 'Kertas A4 80gsm', inventoryAccountId: 'acc-inv' },
  { id: 'item-2', sku: 'SKU-002', name: 'Tinta Printer', inventoryAccountId: 'acc-inv' },
  { id: 'item-3', sku: 'SKU-003', name: 'Tinta Printer Black', inventoryAccountId: 'acc-inv' },
];

describe('normalizeSupplierLabel', () => {
  it('normalizes supplier labels for durable matching keys', () => {
    expect(normalizeSupplierLabel('  SKU-001 / Kertas  A4 ')).toBe('sku 001 kertas a4');
  });
});

describe('analyzeBillImportText', () => {
  it('matches an item by exact supplier SKU from the PDF text', () => {
    const result = analyzeBillImportText({
      text: `
        PT Supplier Sejahtera
        Tanggal Invoice 09/04/2026
        SKU-001 Kertas A4 80gsm 2 PCS 25000 50000
        Total 50000
      `,
      fileName: 'supplier.pdf',
      vendors: baseVendors,
      items: baseItems,
      mappings: [],
    });

    expect(result.reviewData.vendorId).toBe('vendor-1');
    expect(result.reviewData.lines[0].itemId).toBe('item-1');
    expect(result.reviewData.lines[0].accountId).toBe('acc-inv');
    expect(result.reviewData.lines[0].reviewStatus).toBe('matched');
  });

  it('prefers a previously approved supplier mapping before fuzzy matching items', () => {
    const result = analyzeBillImportText({
      text: `
        PT Supplier Sejahtera
        Tanggal Invoice 09/04/2026
        KRT A4 PREMIUM 1 PCS 50000 50000
        Total 50000
      `,
      fileName: 'supplier.pdf',
      vendors: baseVendors,
      items: baseItems,
      mappings: [{
        vendorId: 'vendor-1',
        supplierLabel: 'KRT A4 PREMIUM',
        normalizedSupplierLabel: 'krt a4 premium',
        itemId: 'item-1',
        accountId: 'acc-inv',
      }],
    });

    expect(result.reviewData.lines[0].itemId).toBe('item-1');
    expect(result.reviewData.lines[0].itemSuggestion?.reason).toContain('previously approved');
  });

  it('flags ambiguous fuzzy matches for manual review', () => {
    const result = analyzeBillImportText({
      text: `
        PT Supplier Sejahtera
        Tanggal Invoice 09/04/2026
        Tinta Printer 1 PCS 70000 70000
        Total 70000
      `,
      fileName: 'supplier.pdf',
      vendors: baseVendors,
      items: [
        { id: 'item-black', sku: 'SKU-BLK', name: 'Tinta Printer Black', inventoryAccountId: 'acc-inv' },
        { id: 'item-color', sku: 'SKU-CLR', name: 'Tinta Printer Color', inventoryAccountId: 'acc-inv' },
      ],
      mappings: [],
    });

    expect(result.reviewData.lines[0].itemSuggestion?.label).toContain('Tinta Printer');
    expect(result.reviewData.lines[0].reviewStatus).toBe('needs_review');
    expect(result.reviewData.readyToImport).toBe(false);
  });

  it('keeps unmatched lines in manual review state instead of auto-creating data', () => {
    const result = analyzeBillImportText({
      text: `
        PT Supplier Sejahtera
        Tanggal Invoice 09/04/2026
        Jasa Instalasi Jaringan 1 LOT 500000 500000
        Total 500000
      `,
      fileName: 'supplier.pdf',
      vendors: baseVendors,
      items: baseItems,
      mappings: [],
    });

    expect(result.reviewData.lines[0].itemId).toBeNull();
    expect(result.reviewData.lines[0].accountId).toBeNull();
    expect(result.reviewData.lines[0].reviewStatus).toBe('needs_review');
  });
});
