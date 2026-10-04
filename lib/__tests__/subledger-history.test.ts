import { expect, it } from 'vitest';
import { reportDate } from '../subledger-history';

it('uses Jakarta month-end boundaries independent of the server timezone', () => {
  expect(reportDate('2026-09-30', false).toISOString()).toBe('2026-09-29T17:00:00.000Z');
  expect(reportDate('2026-09-30', true).toISOString()).toBe('2026-09-30T16:59:59.999Z');
  expect(reportDate('2026-10-01', false).getTime()).toBe(reportDate('2026-09-30', true).getTime() + 1);
});

it.each(['2026-02-30', 'nonsense', '2026-13-01'])('rejects invalid calendar date %s', date => {
  expect(() => reportDate(date, true)).toThrow(/Invalid date/);
});
