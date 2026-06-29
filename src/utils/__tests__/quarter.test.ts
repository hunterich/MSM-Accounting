import { describe, it, expect } from 'vitest';
import { currentQuarter, quarterRange, stepQuarter, formatQuarterLabel } from '../quarter';

describe('quarter helpers', () => {
    it('currentQuarter maps month to quarter', () => {
        expect(currentQuarter(new Date(2026, 0, 15))).toEqual({ year: 2026, quarter: 1 });  // Jan
        expect(currentQuarter(new Date(2026, 5, 1))).toEqual({ year: 2026, quarter: 2 });   // Jun
        expect(currentQuarter(new Date(2026, 8, 30))).toEqual({ year: 2026, quarter: 3 });  // Sep
        expect(currentQuarter(new Date(2026, 11, 31))).toEqual({ year: 2026, quarter: 4 }); // Dec
    });

    it('quarterRange returns the first and last day of the quarter', () => {
        expect(quarterRange(2026, 1)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-03-31' });
        expect(quarterRange(2026, 2)).toEqual({ dateFrom: '2026-04-01', dateTo: '2026-06-30' });
        expect(quarterRange(2026, 3)).toEqual({ dateFrom: '2026-07-01', dateTo: '2026-09-30' });
        expect(quarterRange(2026, 4)).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-12-31' });
    });

    it('stepQuarter rolls over year boundaries', () => {
        expect(stepQuarter(2026, 1, -1)).toEqual({ year: 2025, quarter: 4 });
        expect(stepQuarter(2026, 4, 1)).toEqual({ year: 2027, quarter: 1 });
        expect(stepQuarter(2026, 2, 2)).toEqual({ year: 2026, quarter: 4 });
        expect(stepQuarter(2026, 1, -5)).toEqual({ year: 2024, quarter: 4 });
        expect(stepQuarter(2026, 3, 0)).toEqual({ year: 2026, quarter: 3 });
    });

    it('formatQuarterLabel', () => {
        expect(formatQuarterLabel(2026, 2)).toBe('Q2 2026');
    });
});
