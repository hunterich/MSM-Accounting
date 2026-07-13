import { describe, it, expect } from 'vitest';
import { computeServiceCharge } from '../sales-type-charge';

describe('computeServiceCharge', () => {
  it('returns zero when pct is 0', () => {
    expect(computeServiceCharge({ goodsTotal: 100000, pct: 0, taxable: true, rate: 11 }))
      .toEqual({ chargeAmt: 0, taxAddon: 0 });
  });

  it('taxable charge: amount = pct% of goods total; taxAddon splits embedded PPN out', () => {
    const r = computeServiceCharge({ goodsTotal: 100000, pct: 1, taxable: true, rate: 11 });
    expect(r.chargeAmt).toBe(1000);
    expect(r.taxAddon).toBeCloseTo(99.1, 1);
  });

  it('non-taxable charge: no tax added', () => {
    const r = computeServiceCharge({ goodsTotal: 100000, pct: 2, taxable: false, rate: 11 });
    expect(r.chargeAmt).toBe(2000);
    expect(r.taxAddon).toBe(0);
  });
});
