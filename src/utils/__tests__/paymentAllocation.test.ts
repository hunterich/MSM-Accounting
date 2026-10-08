import { describe, expect, it } from 'vitest';
import { paymentAllocation } from '../paymentAllocation';

describe('payment allocation', () => {
    it('defaults to the outstanding balance', () => {
        expect(paymentAllocation(1400, { discount: 0, penalty: 0 })).toMatchObject({ settlement: 1400, amountApplied: 1400, cash: 1400, valid: true });
    });
    it('settles 600 with 550 principal cash, 50 discount and 10 additional fee', () => {
        expect(paymentAllocation(2000, { settlementAmount: 600, discount: 50, penalty: 10 })).toEqual({ settlement: 600, amountApplied: 550, discount: 50, penalty: 10, cash: 560, valid: true });
    });
    it('keeps decimal currency values consistent', () => {
        expect(paymentAllocation(2000, { settlementAmount: 600.25, discount: 50.10, penalty: 10.05 })).toMatchObject({ amountApplied: 550.15, cash: 560.20, valid: true });
    });
    it.each([
        { settlementAmount: 0, discount: 0, penalty: 0 },
        { settlementAmount: -1, discount: 0, penalty: 0 },
        { settlementAmount: 2001, discount: 0, penalty: 0 },
        { settlementAmount: 600, discount: 601, penalty: 0 },
        { settlementAmount: 600, discount: -1, penalty: 0 },
        { settlementAmount: 600, discount: 0, penalty: -1 },
        { settlementAmount: NaN, discount: 0, penalty: 0 },
        { settlementAmount: 600, discount: 0, penalty: Infinity },
    ])('rejects an invalid settlement: %j', adjustment => {
        expect(paymentAllocation(2000, adjustment).valid).toBe(false);
    });
});
