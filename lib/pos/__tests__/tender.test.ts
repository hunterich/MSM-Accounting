import { describe, expect, it } from 'vitest';
import { validateCashTender } from '../tender';

describe('validateCashTender', () => {
  it('returns change when cash covers the total', () => {
    expect(validateCashTender(19000, 20000)).toEqual({ ok: true, change: 1000 });
  });

  it('returns zero change on exact payment', () => {
    expect(validateCashTender(19000, 19000)).toEqual({ ok: true, change: 0 });
  });

  it('rejects when cash is insufficient', () => {
    expect(validateCashTender(19000, 15000)).toEqual({ ok: false, change: 0, reason: 'Insufficient cash tendered' });
  });

  it('rejects a non-positive total', () => {
    expect(validateCashTender(0, 0)).toEqual({ ok: false, change: 0, reason: 'Sale total must be greater than zero' });
  });
});
