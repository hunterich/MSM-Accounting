import { describe, it, expect } from 'vitest';
import { flattenSaleLines } from '../modifier-lines';
import type { SaleLineInput } from '../pricing';

const base: SaleLineInput = { itemId: 'coffee', description: 'Coffee', quantity: 2, price: 20000, discountPct: 0 };

describe('flattenSaleLines', () => {
  it('emits a base line then a child line per priced/item-linked option', () => {
    const lines: SaleLineInput[] = [{ ...base, modifiers: [
      { groupId: 'milk', groupName: 'Milk', optionId: 'oat', optionName: 'Oat', priceDelta: 5000, itemId: 'oatItem' },
      { groupId: 'sz', groupName: 'Size', optionId: 'lg', optionName: 'Large', priceDelta: 3000, itemId: null },
    ] }];
    const out = flattenSaleLines(lines);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ lineNo: 1, itemId: 'coffee', isModifier: false, price: 20000, quantity: 2 });
    expect(out[1]).toMatchObject({ lineNo: 2, parentLineNo: 1, isModifier: true, itemId: 'oatItem', price: 5000, quantity: 2, description: 'Oat' });
    expect(out[2]).toMatchObject({ lineNo: 3, parentLineNo: 1, isModifier: true, itemId: null, price: 3000, quantity: 2, description: 'Large' });
  });

  it('records free ($0, no item) options as modifierNote on the base line, no child line', () => {
    const lines: SaleLineInput[] = [{ ...base, modifiers: [
      { groupId: 'sugar', groupName: 'Sugar', optionId: 'no', optionName: 'No sugar', priceDelta: 0, itemId: null },
    ] }];
    const out = flattenSaleLines(lines);
    expect(out).toHaveLength(1);
    expect(out[0].modifierNote).toBe('No sugar');
  });

  it('child lines inherit the base line discount so a discounted modified line reconciles', () => {
    const out = flattenSaleLines([{ itemId: 'coffee', description: 'Coffee', quantity: 2, price: 20000, discountPct: 10, modifiers: [
      { groupId: 'milk', groupName: 'Milk', optionId: 'oat', optionName: 'Oat', priceDelta: 5000, itemId: 'oatItem' },
    ] }]);
    expect(out[0].discountPct).toBe(10);
    expect(out[1].discountPct).toBe(10);
    // sum of discounted line subtotals == q*(base+delta)*(1-0.1)
    const sub = out.reduce((s, l) => s + l.quantity * l.price * (1 - l.discountPct / 100), 0);
    expect(sub).toBe(2 * 25000 * 0.9);
  });

  it('passes the base line through unchanged when no modifiers', () => {
    const out = flattenSaleLines([{ ...base, modifiers: [] }]);
    expect(out).toEqual([{ lineNo: 1, parentLineNo: null, isModifier: false, itemId: 'coffee', description: 'Coffee', quantity: 2, price: 20000, discountPct: 0, performedById: null, modifierNote: null }]);
  });
});
