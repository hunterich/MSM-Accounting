import { describe, it, expect } from 'vitest';
import {
    parseFormDate,
    isPeriodBlocked,
    findPeriodForDate,
    resolvePeriodLock,
    type LockablePeriod,
} from '../periodLock';

/**
 * The banner is only useful if it agrees with `lib/period-guard.ts`. A false
 * "open" is survivable — the server still refuses — but a false "closed" tells
 * someone their document can't be saved when it can, so the boundary cases
 * below are the point of this file.
 */

/** Twelve monthly periods are built with endDate = last millisecond of the month. */
const month = (name: string, y: number, m: number, over: Partial<LockablePeriod> = {}): LockablePeriod => ({
    name,
    startDate: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    endDate: new Date(Date.UTC(y, m, 1) - 1).toISOString(),
    status: 'OPEN',
    isLocked: false,
    ...over,
});

const PERIODS: LockablePeriod[] = [
    month('2026-01', 2026, 1, { status: 'CLOSED' }),
    month('2026-02', 2026, 2, { isLocked: true }),
    month('2026-03', 2026, 3),
];

describe('parseFormDate', () => {
    it('reads a date input value as UTC midnight, matching the API', () => {
        expect(parseFormDate('2026-03-15')).toBe(Date.UTC(2026, 2, 15));
    });

    it('treats an empty or partial value as no date', () => {
        expect(parseFormDate('')).toBeNull();
        expect(parseFormDate(null)).toBeNull();
        expect(parseFormDate(undefined)).toBeNull();
        expect(parseFormDate('2026-03')).toBeNull();
        expect(parseFormDate('15/03/2026')).toBeNull();
    });

    it('rejects a day that does not exist rather than rolling it forward', () => {
        // Date.UTC(2026, 1, 31) silently becomes 3 March.
        expect(parseFormDate('2026-02-31')).toBeNull();
        expect(parseFormDate('2026-13-01')).toBeNull();
        expect(parseFormDate('2026-00-10')).toBeNull();
    });

    it('accepts a leap day in a leap year and rejects it otherwise', () => {
        expect(parseFormDate('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
        expect(parseFormDate('2026-02-29')).toBeNull();
    });
});

describe('isPeriodBlocked', () => {
    it('blocks on CLOSED or isLocked, the same two conditions as the guard', () => {
        expect(isPeriodBlocked(month('m', 2026, 5))).toBe(false);
        expect(isPeriodBlocked(month('m', 2026, 5, { status: 'CLOSED' }))).toBe(true);
        expect(isPeriodBlocked(month('m', 2026, 5, { isLocked: true }))).toBe(true);
    });
});

describe('findPeriodForDate', () => {
    it('includes both endpoints of the range', () => {
        expect(findPeriodForDate(PERIODS, Date.UTC(2026, 0, 1))?.name).toBe('2026-01');
        expect(findPeriodForDate(PERIODS, Date.UTC(2026, 0, 31))?.name).toBe('2026-01');
    });

    it('returns null for a date no period covers', () => {
        expect(findPeriodForDate(PERIODS, Date.UTC(2025, 11, 31))).toBeNull();
        expect(findPeriodForDate(PERIODS, Date.UTC(2026, 3, 1))).toBeNull();
    });

    it('ignores a period with an unparseable range instead of matching it', () => {
        const broken = [{ ...month('bad', 2026, 1), startDate: 'not-a-date' }];
        expect(findPeriodForDate(broken, Date.UTC(2026, 0, 15))).toBeNull();
    });
});

describe('resolvePeriodLock', () => {
    it('is unknown until the periods have loaded', () => {
        expect(resolvePeriodLock(undefined, '2026-01-15').status).toBe('unknown');
        expect(resolvePeriodLock([], '2026-01-15', false).status).toBe('unknown');
    });

    it('is unknown while the date field is empty', () => {
        expect(resolvePeriodLock(PERIODS, '').status).toBe('unknown');
    });

    it('blocks a date inside a closed period and names it', () => {
        const lock = resolvePeriodLock(PERIODS, '2026-01-15');
        expect(lock.status).toBe('blocked');
        expect(lock.period?.name).toBe('2026-01');
        expect(lock.message).toContain('"2026-01"');
        expect(lock.message).toContain('closed');
        expect(lock.message).toContain('2026-01-15');
    });

    it('blocks a locked period and says locked, not closed', () => {
        const lock = resolvePeriodLock(PERIODS, '2026-02-10');
        expect(lock.status).toBe('blocked');
        expect(lock.message).toContain('is locked');
    });

    it('allows a date in an open period, and still reports which one', () => {
        const lock = resolvePeriodLock(PERIODS, '2026-03-15');
        expect(lock.status).toBe('open');
        expect(lock.period?.name).toBe('2026-03');
        expect(lock.message).toBeNull();
    });

    it('allows a date no period covers — an undefined period is not yet closed', () => {
        const lock = resolvePeriodLock(PERIODS, '2026-06-01');
        expect(lock.status).toBe('open');
        expect(lock.period).toBeNull();
    });

    it('allows any date when the company has defined no periods at all', () => {
        expect(resolvePeriodLock([], '2026-01-15', true).status).toBe('open');
    });

    it('does not block on the last millisecond boundary between two months', () => {
        // 31 Jan is closed, 1 Feb belongs to the next period.
        expect(resolvePeriodLock(PERIODS, '2026-01-31').status).toBe('blocked');
        expect(resolvePeriodLock(PERIODS, '2026-03-01').status).toBe('open');
    });
});
