import { describe, expect, it } from 'vitest';
import { computeSaleTotals, type SaleLineInput } from '../pricing';

const lines: SaleLineInput[] = [
  { itemId: 'i1', description: 'Paracetamol', quantity: 2, price: 5000, discountPct: 0 },
  { itemId: 'i2', description: 'Vitamin C', quantity: 1, price: 10000, discountPct: 10 },
];

describe('computeSaleTotals (tax-inclusive, 11%)', () => {
  it('sums line totals net of line discount', () => {
    const t = computeSaleTotals(lines, 11);
    expect(t.totalAmount).toBe(19000);
  });

  it('extracts embedded PPN from the gross total', () => {
    const t = computeSaleTotals(lines, 11);
    expect(t.taxAmount).toBeCloseTo(1882.88, 2);
    expect(t.subtotal).toBeCloseTo(19000 - 1882.88, 2);
  });

  it('returns zeros for an empty cart', () => {
    const t = computeSaleTotals([], 11);
    expect(t).toEqual({ subtotal: 0, taxAmount: 0, totalAmount: 0 });
  });
});
