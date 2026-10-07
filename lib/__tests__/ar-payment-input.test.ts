import { describe, expect, it } from 'vitest';
import { normalizeArPaymentAccount } from '../ar-payment-input';

describe('AR cash-account alias', () => {
  it('maps the shared alias without leaking an unknown Prisma field', () => {
    expect(normalizeArPaymentAccount({ cashAccountId: 'cash', reference: 'receipt' })).toEqual({ depositAccountId: 'cash', reference: 'receipt' });
    expect(normalizeArPaymentAccount({ depositAccountId: 'cash' })).toEqual({ depositAccountId: 'cash' });
  });
  it('rejects conflicting account IDs and leaves partial updates unchanged', () => {
    expect(() => normalizeArPaymentAccount({ cashAccountId: 'a', depositAccountId: 'b' })).toThrow(/same account/);
    expect(normalizeArPaymentAccount({ reference: 'edit' })).toEqual({ reference: 'edit' });
  });
});
