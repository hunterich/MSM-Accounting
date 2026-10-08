import { describe, expect, it } from 'vitest';
import { billingDay, businessDayStart, nextRecurringDate } from '../billing-calendar';

describe('billing calendar', () => {
  it('runs the new Jakarta day while the server is still on the previous UTC day', () => {
    expect(billingDay(new Date('2026-10-07T17:01:00Z')).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(businessDayStart('2026-10-08', 'Asia/Jakarta').toISOString()).toBe('2026-10-07T17:00:00.000Z');
  });
  it('clamps January 31 before advancing the month and recovers the configured billing day in March', () => {
    const feb = nextRecurringDate(new Date('2026-01-31T00:00:00Z'), 'MONTHLY', 31);
    expect(feb.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(nextRecurringDate(feb, 'MONTHLY', 31).toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });
  it('clamps leap-day annual billing and rejects unknown frequencies', () => {
    expect(nextRecurringDate(new Date('2024-02-29T00:00:00Z'), 'ANNUAL').toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(() => nextRecurringDate(new Date(), 'UNKNOWN')).toThrow('Unsupported');
  });
});
