import { describe, expect, it } from 'vitest';
import { pricePosSale, type SaleLineInput } from '../pricing';

const lines: SaleLineInput[] = [
  { itemId: 'i1', description: 'Paracetamol', quantity: 2, price: 5000, discountPct: 0 },
  { itemId: 'i2', description: 'Vitamin C', quantity: 1, price: 10000, discountPct: 10 },
];

describe('pricePosSale', () => {
  it('sums line totals net of line discount', () => {
    const t = pricePosSale(lines);
    expect(t.totalAmount.toFixed(2)).toBe('19000.00');
  });

  it('extracts embedded PPN from the gross total', () => {
    const t = pricePosSale(lines);
    expect(t.taxAmount.toFixed(2)).toBe('1882.88');
    expect(t.subtotal.toFixed(2)).toBe('17117.12');
  });

  it('returns zeros for an empty cart', () => {
    const t = pricePosSale([]);
    expect([t.subtotal, t.taxAmount, t.totalAmount].map(amount => amount.toFixed(2))).toEqual(['0.00', '0.00', '0.00']);
  });

  it('groups the same rounded base and modifier rows that checkout saves', () => {
    const sale = pricePosSale([{
      ...lines[0], quantity: 0.3333, price: 20, modifiers: [
        { groupId: 'size', groupName: 'Size', optionId: 'large', optionName: 'Large', priceDelta: 10 },
      ],
    }]);
    expect(sale.lines.map(line => line.lineSubtotal.toFixed(2))).toEqual(['3.33', '3.33']);
    expect(sale.cartLineTotals.map(amount => amount.toFixed(2))).toEqual(['6.66']);
    expect(sale.totalAmount.toFixed(2)).toBe('6.66');
  });

  it('keeps the goods and service charge free of PPN for a non-taxable sales type', () => {
    const sale = pricePosSale(lines, { taxable: false, serviceChargePct: 1 });
    expect([sale.subtotal, sale.serviceChargeNet, sale.taxAmount, sale.totalAmount].map(amount => amount.toFixed(2)))
      .toEqual(['19000.00', '190.00', '0.00', '19190.00']);
  });
});
