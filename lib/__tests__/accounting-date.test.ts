import { describe, expect, it } from 'vitest';
import { accountingDay, accountingRangeBounds, toAccountingDate } from '../accounting-date';
import { reportDate } from '../subledger-history';

describe('toAccountingDate', () => {
  it('leaves a date-only document date (00:00 UTC) unchanged', () => {
    const d = new Date('2026-11-01T00:00:00.000Z');
    expect(toAccountingDate(d)).toEqual(d);
  });

  it('folds a clock time to the Jakarta business day it happened on', () => {
    // 02:00 WIB on 1 Nov = 19:00 UTC on 31 Oct.
    expect(toAccountingDate(new Date('2026-10-31T19:00:00.000Z')))
      .toEqual(new Date('2026-11-01T00:00:00.000Z'));
    // 23:59 WIB on 31 Oct = 16:59 UTC on 31 Oct.
    expect(toAccountingDate(new Date('2026-10-31T16:59:00.000Z')))
      .toEqual(new Date('2026-10-31T00:00:00.000Z'));
  });

  it('is idempotent', () => {
    const once = toAccountingDate(new Date('2026-10-31T19:00:00.000Z'));
    expect(toAccountingDate(once)).toEqual(once);
  });

  it('agrees with reportDate: the stamp lies inside the same report day', () => {
    for (const instant of ['2026-10-31T17:00:00.000Z', '2026-11-01T06:59:59.999Z', '2026-11-01T12:00:00.000Z']) {
      const stamp = toAccountingDate(new Date(instant));
      const day = accountingDay(new Date(instant));
      expect(stamp >= reportDate(day, false) && stamp <= reportDate(day, true)).toBe(true);
    }
  });

  it('rejects an invalid date', () => {
    expect(() => toAccountingDate(new Date('nope'))).toThrow(/invalid date/);
  });
});

describe('accountingRangeBounds', () => {
  it('spans the Jakarta days from the first to the last day of a UTC period', () => {
    const bounds = accountingRangeBounds(
      new Date('2026-11-01T00:00:00.000Z'),
      new Date('2026-11-30T23:59:59.999Z'),
    );
    expect(bounds).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-30T16:59:59.999Z'),
    });
    // Stamps on the convention select exactly the month.
    const inside = (d: string) => new Date(d) >= bounds.gte && new Date(d) <= bounds.lte;
    expect(inside('2026-11-01T00:00:00.000Z')).toBe(true);
    expect(inside('2026-11-30T00:00:00.000Z')).toBe(true);
    expect(inside('2026-10-31T00:00:00.000Z')).toBe(false);
    expect(inside('2026-12-01T00:00:00.000Z')).toBe(false);
    // An older clock-time posting at 02:00 WIB on 1 Dec belongs to December.
    expect(inside('2026-11-30T19:00:00.000Z')).toBe(false);
  });
});
