import { describe, it, expect } from 'vitest';
import { marketplaceImportInputSchema } from '../../types/api';

describe('marketplaceImportInputSchema', () => {
  it('accepts a valid order batch', () => {
    const r = marketplaceImportInputSchema.safeParse({
      orders: [{
        orderNo: 'A1', issueDate: '2026-06-03',
        lines: [{ itemId: 'i1', description: 'X', sku: 'CC211D', quantity: 1, unitPrice: 49304 }],
      }],
      options: { recordPayment: true },
    });
    expect(r.success).toBe(true);
  });
  it('rejects a line with no itemId (master-only rule)', () => {
    const r = marketplaceImportInputSchema.safeParse({
      orders: [{ orderNo: 'A1', issueDate: '2026-06-03', lines: [{ description: 'X', sku: 'S', quantity: 1, unitPrice: 1 }] }],
      options: { recordPayment: true },
    });
    expect(r.success).toBe(false);
  });
  it('rejects an empty orders array', () => {
    const r = marketplaceImportInputSchema.safeParse({ orders: [], options: { recordPayment: true } });
    expect(r.success).toBe(false);
  });
});
