import { describe, it, expect } from 'vitest';
import { computeServiceCharge } from '../sales-type-charge';

describe('computeServiceCharge', () => {
  it('returns zero when pct is 0', () => {
    const { chargeAmt, taxAddon } = computeServiceCharge({ goodsTotal: 100000, pct: 0, rate: 11 });
    expect([chargeAmt.toFixed(2), taxAddon.toFixed(2)]).toEqual(['0.00', '0.00']);
  });

  it('taxable charge: amount = pct% of goods total; taxAddon splits embedded PPN out', () => {
    const r = computeServiceCharge({ goodsTotal: 100000, pct: 1, rate: 11 });
    expect(r.chargeAmt.toFixed(2)).toBe('1000.00');
    expect(r.taxAddon.toFixed(2)).toBe('99.10');
  });

  it('non-taxable charge: no tax added', () => {
    const r = computeServiceCharge({ goodsTotal: 100000, pct: 2, rate: 0 });
    expect(r.chargeAmt.toFixed(2)).toBe('2000.00');
    expect(r.taxAddon.toFixed(2)).toBe('0.00');
  });
});
