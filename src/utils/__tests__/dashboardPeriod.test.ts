import { describe, expect, it } from 'vitest';
import { dashboardPeriod, jakartaToday, percentageChange, previousYear } from '../dashboardPeriod';

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
