import { describe, it, expect } from 'vitest';
import { calculateNextPeriod, type BillingInterval } from '../subscription';

/**
 * Fixed anchor: 2024-01-31 (month-end, good stress test for month-end handling).
 * Period-end passed in → next period start = Feb 1, end varies by interval.
 */
const JAN_31 = new Date('2024-01-31');

describe('calculateNextPeriod', () => {
  it('MONTHLY advances by 1 month', () => {
    const { start, end } = calculateNextPeriod(JAN_31, 'MONTHLY');
    expect(start.toISOString().slice(0, 10)).toBe('2024-02-01');
    expect(end.toISOString().slice(0, 10)).toBe('2024-02-29'); // 2024 is a leap year
  });

  it('QUARTERLY advances by 3 months', () => {
    const { start, end } = calculateNextPeriod(JAN_31, 'QUARTERLY');
    expect(start.toISOString().slice(0, 10)).toBe('2024-02-01');
    // Feb 1 + 3 months = May 1, minus 1 day = Apr 30
    expect(end.toISOString().slice(0, 10)).toBe('2024-04-30');
  });

  it('SEMI_ANNUAL advances by 6 months', () => {
    const { start, end } = calculateNextPeriod(JAN_31, 'SEMI_ANNUAL');
    expect(start.toISOString().slice(0, 10)).toBe('2024-02-01');
    // Feb 1 + 6 months = Aug 1, minus 1 day = Jul 31
    expect(end.toISOString().slice(0, 10)).toBe('2024-07-31');
  });

  it('ANNUAL advances by 1 year', () => {
    const { start, end } = calculateNextPeriod(JAN_31, 'ANNUAL');
    expect(start.toISOString().slice(0, 10)).toBe('2024-02-01');
    // Feb 1 + 1 year = 2025-02-01, minus 1 day = 2025-01-31
    expect(end.toISOString().slice(0, 10)).toBe('2025-01-31');
  });

  it('returns start = currentPeriodEnd + 1 day', () => {
    const base = new Date('2024-03-15');
    const { start } = calculateNextPeriod(base, 'MONTHLY');
    expect(start.toISOString().slice(0, 10)).toBe('2024-03-16');
  });

  it('accepts a string date input', () => {
    const { start, end } = calculateNextPeriod('2024-06-30', 'SEMI_ANNUAL');
    expect(start.toISOString().slice(0, 10)).toBe('2024-07-01');
    // Jul 1 + 6 months = Jan 1 2025, minus 1 day = Dec 31 2024
    expect(end.toISOString().slice(0, 10)).toBe('2024-12-31');
  });

  it('throws on an unknown interval', () => {
    expect(() =>
      calculateNextPeriod(JAN_31, 'WEEKLY' as BillingInterval),
    ).toThrow(/Unknown BillingInterval/);
  });
});
