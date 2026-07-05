import { describe, expect, it } from 'vitest';
import { emptyCart, addItem, setQty, setDiscount, removeLine, cartTotal, type CatalogItem } from '../cart';

const paracetamol: CatalogItem = { id: 'i1', sku: 'PCT', name: 'Paracetamol', barcode: '899001', sellingPrice: 5000 };
const vitc: CatalogItem = { id: 'i2', sku: 'VITC', name: 'Vitamin C', barcode: '899002', sellingPrice: 10000 };

describe('cart', () => {
  it('adds an item as a new line with qty 1', () => {
    const c = addItem(emptyCart(), paracetamol);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ itemId: 'i1', quantity: 1, price: 5000, discountPct: 0 });
  });
  it('merges a repeat add into qty', () => {
    const c = addItem(addItem(emptyCart(), paracetamol), paracetamol);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].quantity).toBe(2);
  });
  it('sets qty and removes the line when qty <= 0', () => {
    let c = addItem(emptyCart(), paracetamol);
    c = setQty(c, 'i1', 3);
    expect(c.lines[0].quantity).toBe(3);
    c = setQty(c, 'i1', 0);
    expect(c.lines).toHaveLength(0);
  });
  it('applies a per-line discount and removes a line', () => {
    let c = addItem(addItem(emptyCart(), paracetamol), vitc);
    c = setDiscount(c, 'i2', 10);
    expect(c.lines.find((l) => l.itemId === 'i2')?.discountPct).toBe(10);
    c = removeLine(c, 'i1');
    expect(c.lines.map((l) => l.itemId)).toEqual(['i2']);
  });
  it('computes the tax-inclusive total', () => {
    let c = addItem(emptyCart(), paracetamol); // 2x5000
    c = setQty(c, 'i1', 2);
    c = addItem(c, vitc);                        // 1x10000 -10%
    c = setDiscount(c, 'i2', 10);
    expect(cartTotal(c)).toBe(19000); // 10000 + 9000
  });
});
