import { describe, expect, it } from 'vitest';
import {
  wibMonthRange,
  saleTargetStatus,
  computeSalesPerformance,
  UNASSIGNED,
} from '../sales-performance';

describe('wibMonthRange', () => {
  it('spans the WIB calendar month as UTC instants', () => {
    const r = wibMonthRange('2026-07', new Date('2026-07-20T00:00:00Z'));
    // WIB midnight 2026-07-01 == 2026-06-30T17:00:00Z
    expect(r.start.toISOString()).toBe('2026-06-30T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(r.daysInMonth).toBe(31);
  });

  it('counts a sale just after WIB midnight on the 1st into the new month', () => {
    const r = wibMonthRange('2026-07', new Date('2026-07-20T00:00:00Z'));
    const justAfterMidnightWib = new Date('2026-06-30T17:30:00.000Z'); // 00:30 WIB Jul 1
    expect(justAfterMidnightWib >= r.start && justAfterMidnightWib < r.end).toBe(true);
  });

  it('reports full days elapsed for a past month and zero for a future one', () => {
    expect(wibMonthRange('2026-07', new Date('2026-09-01T00:00:00Z')).daysElapsed).toBe(31);
    expect(wibMonthRange('2026-07', new Date('2026-05-01T00:00:00Z')).daysElapsed).toBe(0);
  });

  it('rejects a malformed month', () => {
    expect(() => wibMonthRange('2026-13', new Date('2026-07-20T00:00:00Z'))).toThrow();
  });
});

describe('saleTargetStatus', () => {
  it('is green when target met or on pace, amber near pace, red below, null without target', () => {
    expect(saleTargetStatus(100, 100, 50)).toBe('green'); // met
    expect(saleTargetStatus(60, 100, 50)).toBe('green');  // ahead of pace
    expect(saleTargetStatus(46, 100, 50)).toBe('amber');  // >= 0.9*expected
    expect(saleTargetStatus(10, 100, 50)).toBe('red');
    expect(saleTargetStatus(10, 0, 0)).toBeNull();
  });
});

describe('computeSalesPerformance', () => {
  it('rolls up sold per employee, applies targets, and appends an Unassigned row', () => {
    const res = computeSalesPerformance({
      soldByEmployee: { e1: 8000, e2: 3000, [UNASSIGNED]: 500 },
      targets: { e1: 10000, e3: 5000 },
      names: { e1: 'Ani', e2: 'Budi', e3: 'Citra' },
      daysInMonth: 30,
      daysElapsed: 30,
    });
    const ani = res.rows.find((r) => r.employeeId === 'e1')!;
    expect(ani.sold).toBe(8000);
    expect(ani.pct).toBe(80);
    expect(ani.remaining).toBe(2000);
    expect(ani.status).toBe('red'); // 8000 < expected 10000 at full pace, < 0.9*10000
    const citra = res.rows.find((r) => r.employeeId === 'e3')!; // target, no sales
    expect(citra.sold).toBe(0);
    const budi = res.rows.find((r) => r.employeeId === 'e2')!; // sales, no target
    expect(budi.pct).toBeNull();
    const unassigned = res.rows.find((r) => r.employeeId === null)!;
    expect(unassigned.name).toBe('Unassigned');
    expect(unassigned.sold).toBe(500);
    expect(res.totals.sold).toBe(11500);
    expect(res.totals.target).toBe(15000);
  });
});
