import { describe, it, expect } from 'vitest';
import { calculateInvoiceTotals } from '../invoice-totals';
import { computeInvoiceFormTotals, invoiceFormLineTotal } from '../../src/views/ar/invoiceFormTotals';

describe('calculateInvoiceTotals', () => {
  const orgDefaults = {
    taxEnabled: true,
    taxDefaultRate: 11,
    taxInclusiveByDefault: false,
  };

  it('shows Rp6.66 in the invoice preview by summing two rounded Rp3.33 lines', () => {
    const formLines = ['First', 'Second'].map(description => ({ description, quantity: 0.3333, price: 10 }));
    const tax = { enabled: false, inclusive: false, rate: 0 };
    expect(formLines.map(line => invoiceFormLineTotal(line))).toEqual([3.33, 3.33]);
    const preview = computeInvoiceFormTotals(formLines, [], 0, tax);
    expect(preview.subtotal.toFixed(2)).toBe('6.66');
    expect(preview.totalAmount.toFixed(2)).toBe('6.66');
  });

  it('keeps an imported Rp6.67 in the editor until the line pricing changes', () => {
    const line = { id: 'line', description: 'Marketplace item', quantity: 3, price: 2.22 };
    const saved = { ...line, discountPct: 0, lineSubtotal: 6.67 };
    const savedLines = new Map([[line.id, saved]]);
    const tax = { enabled: false, inclusive: false, rate: 0 };
    expect(invoiceFormLineTotal(line, saved)).toBe(6.67);
    expect(computeInvoiceFormTotals([line], [], 0, tax, savedLines).totalAmount.toFixed(2)).toBe('6.67');
    expect(computeInvoiceFormTotals([{ ...line, price: 2.23 }], [], 0, tax, savedLines).totalAmount.toFixed(2)).toBe('6.69');
  });

  it('computes subtotal/tax/total for a simple 1-line invoice (exclusive tax)', () => {
    const payload = {
      lines: [{ quantity: 2, price: 50000, description: 'Widget' }],
    };
    const t = calculateInvoiceTotals(payload, orgDefaults);

    expect(t.subtotal.toNumber()).toBe(100000);
    expect(t.discountPct.toNumber()).toBe(0);
    expect(t.discountAmount.toNumber()).toBe(0);
    expect(t.taxEnabled).toBe(true);
    expect(t.taxInclusive).toBe(false);
    expect(t.taxRate.toNumber()).toBe(11);
    expect(t.taxAmount.toNumber()).toBe(11000);
    expect(t.totalAmount.toNumber()).toBe(111000);
  });

  it('normalizes line fields and assigns lineNo', () => {
    const payload = {
      lines: [
        { quantity: 1, price: 10000, description: 'A', unit: 'BOX', itemId: 'item-1', code: 'C1' },
        { quantity: 3, price: 5000, description: 'B' },
      ],
    };
    const t = calculateInvoiceTotals(payload, { ...orgDefaults, taxEnabled: false });

    expect(t.lines).toHaveLength(2);
    expect(t.lines.map(line => line.lineSubtotal.toFixed(2))).toEqual(['10000.00', '15000.00']);
    expect(t.lines[0]).toMatchObject({ lineNo: 1, itemId: 'item-1', code: 'C1', unit: 'BOX' });
    expect(t.lines[1]).toMatchObject({ lineNo: 2, itemId: null, code: null, unit: 'PCS' });
    expect(t.subtotal.toNumber()).toBe(25000);
    expect(t.taxAmount.toNumber()).toBe(0);
    expect(t.totalAmount.toNumber()).toBe(25000);
  });

  it('applies line-level discount correctly', () => {
    // qty=1, price=10000, discountPct=10 → gross=10000, lineDiscount=1000, lineSubtotal=9000
    const payload = {
      lines: [{ quantity: 1, price: 10000, discountPct: 10, description: 'Discounted item' }],
    };
    const t = calculateInvoiceTotals(payload, { ...orgDefaults, taxEnabled: false });

    expect(t.lines[0].lineSubtotal.toNumber()).toBe(9000);
    expect(t.subtotal.toNumber()).toBe(9000);
    expect(t.totalAmount.toNumber()).toBe(9000);
  });

  it('applies invoice-level discount', () => {
    // subtotal=10000, discountPct=20 → discountAmount=2000, discountedSubtotal=8000
    // taxAmount=8000*0.11=880, totalAmount=8880
    const payload = {
      lines: [{ quantity: 1, price: 10000, description: 'Item' }],
      discountPct: 20,
    };
    const t = calculateInvoiceTotals(payload, orgDefaults);

    expect(t.subtotal.toNumber()).toBe(10000);
    expect(t.discountPct.toNumber()).toBe(20);
    expect(t.discountAmount.toNumber()).toBe(2000);
    expect(t.taxAmount.toNumber()).toBe(880);
    expect(t.totalAmount.toNumber()).toBe(8880);
  });

  it('reduces the PPN base only by the taxable share of a mixed invoice discount', () => {
    const amounts = calculateInvoiceTotals({
      lines: [
        { quantity: 1, price: 100, description: 'Taxable item', taxable: true },
        { quantity: 1, price: 100, description: 'Exempt item', taxable: false },
      ],
      discountPct: 10,
    }, orgDefaults);
    expect(amounts.discountAmount.toFixed(2)).toBe('20.00');
    expect(amounts.taxableBase.toFixed(2)).toBe('90.00');
    expect(amounts.taxAmount.toFixed(2)).toBe('9.90');
    expect(amounts.totalAmount.toFixed(2)).toBe('189.90');
  });

  it('handles inclusive tax (tax already inside price)', () => {
    // subtotal=11000, discountedSubtotal=11000, taxableBase=11000
    // taxAmount = 11000 - 11000/(1.11) = 11000 - 9909.91 = 1090.09 → asMoney → 1090.09
    // totalAmount = discountedSubtotal + chargesTotal = 11000 (tax already inside)
    const payload = {
      lines: [{ quantity: 1, price: 11000, description: 'Item' }],
      tax: { enabled: true, inclusive: true, rate: 11 },
    };
    const t = calculateInvoiceTotals(payload, orgDefaults);

    expect(t.taxInclusive).toBe(true);
    expect(t.totalAmount.toNumber()).toBe(11000);
    // taxAmount = asMoney(11000 - 11000/1.11)
    const expectedTax = Math.round((11000 - 11000 / 1.11 + Number.EPSILON) * 100) / 100;
    expect(t.taxAmount.toNumber()).toBe(expectedTax);
  });

  it('payload tax fields override orgDefaults', () => {
    const payload = {
      lines: [{ quantity: 1, price: 10000, description: 'Item' }],
      tax: { enabled: false, inclusive: false, rate: 11 },
    };
    const t = calculateInvoiceTotals(payload, orgDefaults);

    expect(t.taxEnabled).toBe(false);
    expect(t.taxAmount.toNumber()).toBe(0);
    expect(t.totalAmount.toNumber()).toBe(10000);
  });

  it('includes non-taxable charges in total but not in taxable base', () => {
    // line subtotal=10000, charge=500 (taxRate=0)
    // taxableBase=10000+0=10000, taxAmount=1100, totalAmount=10000+500+1100=11600
    const payload = {
      lines: [{ quantity: 1, price: 10000, description: 'Item' }],
      charges: [{ label: 'Shipping', accountId: 'acc-1', amount: 500, taxRate: 0 }],
    };
    const t = calculateInvoiceTotals(payload, orgDefaults);

    expect(t.charges).toHaveLength(1);
    expect([t.charges[0].amount.toFixed(2), t.charges[0].taxRate.toFixed(2)]).toEqual(['500.00', '0.00']);
    expect(t.charges[0]).toMatchObject({ lineNo: 1, label: 'Shipping' });
    expect(t.taxAmount.toNumber()).toBe(1100);
    expect(t.totalAmount.toNumber()).toBe(11600);
  });

  it('includes taxable charges in taxable base', () => {
    // line subtotal=10000, taxable charge=500
    // taxableBase=10000+500=10500, taxAmount=10500*0.11=1155, totalAmount=10000+500+1155=11655
    const payload = {
      lines: [{ quantity: 1, price: 10000, description: 'Item' }],
      charges: [{ label: 'Fee', accountId: 'acc-2', amount: 500, taxRate: 11 }],
    };
    const t = calculateInvoiceTotals(payload, orgDefaults);

    expect(t.taxAmount.toNumber()).toBe(1155);
    expect(t.totalAmount.toNumber()).toBe(11655);
  });

  it('returns zero tax when taxEnabled is false from orgDefaults', () => {
    const payload = {
      lines: [{ quantity: 5, price: 20000, description: 'Bulk item' }],
    };
    const t = calculateInvoiceTotals(payload, { taxEnabled: false, taxDefaultRate: 11, taxInclusiveByDefault: false });

    expect(t.taxAmount.toNumber()).toBe(0);
    expect(t.totalAmount.toNumber()).toBe(100000);
  });
});
