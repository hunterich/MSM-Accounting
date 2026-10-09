import { describe, expect, it } from 'vitest';
import { dashboardPeriod, jakartaToday, percentageChange, periodLabel, previousYear, profitRing } from '../dashboardPeriod';

describe('profit/loss ring', () => {
    it('splits income into COGS, expenditure and the profit left over', () => {
        const ring = profitRing({ cogs: 600, expenditure: 200, profit: 200 });
        expect(ring.segments.map(s => [s.key, s.value])).toEqual([['cogs', 600], ['expenditure', 200], ['profit', 200]]);
        expect(ring.gradient).toBe('conic-gradient(#ffca36 0% 60%, #ff5d88 60% 80%, #26d7b0 80% 100%)');
    });
    it('shows only the costs for a loss', () => {
        expect(profitRing({ cogs: 300, expenditure: 100, profit: -50 }).segments.map(s => s.key)).toEqual(['cogs', 'expenditure']);
    });
    it('draws nothing without activity', () => {
        expect(profitRing({ cogs: 0, expenditure: 0, profit: 0 })).toEqual({ segments: [], gradient: '' });
    });
});

describe('period labels', () => {
    it('follows the interface language', () => {
        expect(periodLabel('2026-10-01', '2026-10-08')).toBe('1 Oct 2026 – 8 Oct 2026');
        expect(periodLabel('2026-10-01', '2026-10-08', 'id')).toBe('1 Okt 2026 – 8 Okt 2026');
    });
});

describe('financial widget periods and comparisons', () => {
    it('uses the Jakarta business day at a UTC midnight boundary', () => {
        expect(jakartaToday(new Date('2026-10-07T18:00:00Z'))).toBe('2026-10-08');
    });
    it('shows month/year to date and complete historical periods', () => {
        expect(dashboardPeriod('month', 0, '2026-10-08')).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-08' });
        expect(dashboardPeriod('year', 0, '2026-10-08')).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-10-08' });
        expect(dashboardPeriod('month', -1, '2026-01-08')).toEqual({ dateFrom: '2025-12-01', dateTo: '2025-12-31' });
        expect(dashboardPeriod('year', -1, '2026-10-08')).toEqual({ dateFrom: '2025-01-01', dateTo: '2025-12-31' });
    });
    it('clamps a leap-day comparison to the end of February', () => {
        expect(previousYear('2024-02-29')).toBe('2023-02-28');
    });
    it('avoids infinity for no prior activity and handles a previous loss', () => {
        expect(percentageChange(10, 0)).toBeNull();
        expect(percentageChange(-50, -100)).toBe(50);
        expect(percentageChange(97, 100)).toBe(-3);
    });
});
