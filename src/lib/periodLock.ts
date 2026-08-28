/**
 * Client-side mirror of `lib/period-guard.ts`.
 *
 * The server refuses to post into a CLOSED or locked period, resolving the
 * period by the posting DATE. Until now that refusal only reached the user on
 * submit, as the guard's own 422 — after they had filled in the whole document.
 * These helpers let a form say the same thing while the date field is being
 * edited.
 *
 * The server stays authoritative: this is an early warning, not a gate. It can
 * be wrong in exactly one direction — a period the client hasn't loaded reads
 * as open — and in that case the guard still rejects the post. It is never
 * wrong the other way, because the comparison below is the same comparison
 * `assertPeriodOpen` makes:
 *
 *     startDate <= date <= endDate, blocked when status = CLOSED or isLocked
 *
 * A date outside every defined period is open — an undefined period is simply
 * "not yet closed", which is what the guard does when its query returns no row.
 */

export interface LockablePeriod {
    name: string;
    /** ISO strings as they arrive from the API. */
    startDate: string;
    endDate: string;
    status: 'OPEN' | 'CLOSED';
    isLocked: boolean;
}

export type PeriodLockStatus =
    /** Periods haven't loaded yet, or the date field is empty/unparseable. */
    | 'unknown'
    /** A period contains this date and it is closed or locked — posting will fail. */
    | 'blocked'
    /** Either an open period contains the date, or no period covers it. */
    | 'open';

export interface PeriodLockState {
    status: PeriodLockStatus;
    /** The period containing the date, when one does. */
    period: LockablePeriod | null;
    /** Ready to render. Null unless blocked. */
    message: string | null;
}

const OPEN: PeriodLockState = { status: 'open', period: null, message: null };
const UNKNOWN: PeriodLockState = { status: 'unknown', period: null, message: null };

/**
 * Parse a date input's `YYYY-MM-DD` value to UTC midnight — the same instant
 * the API produces from the same string, so client and server compare like
 * for like. Anything else (empty, partial, `0000-00-00`) is not a date.
 */
export function parseFormDate(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const [, y, m, d] = match;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ms = Date.UTC(year, month - 1, day);
    // Rejects overflow like 2026-02-31, which Date.UTC would roll into March.
    const back = new Date(ms);
    if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
    return ms;
}

/** True when posting into this period would be refused. */
export function isPeriodBlocked(period: LockablePeriod): boolean {
    return period.status === 'CLOSED' || period.isLocked;
}

/** The period whose range contains the instant, or null. Ranges never overlap. */
export function findPeriodForDate(
    periods: readonly LockablePeriod[],
    dateMs: number,
): LockablePeriod | null {
    return (
        periods.find((p) => {
            const start = Date.parse(p.startDate);
            const end = Date.parse(p.endDate);
            if (Number.isNaN(start) || Number.isNaN(end)) return false;
            return start <= dateMs && dateMs <= end;
        }) ?? null
    );
}

/**
 * Resolve what a date field's current value means for posting.
 *
 * `periodsLoaded` is separate from an empty list: a company with no periods
 * defined can post on any date, while periods that simply haven't arrived yet
 * must not be reported as open.
 */
export function resolvePeriodLock(
    periods: readonly LockablePeriod[] | undefined,
    dateValue: string | null | undefined,
    periodsLoaded = periods !== undefined,
): PeriodLockState {
    if (!periodsLoaded || periods === undefined) return UNKNOWN;

    const dateMs = parseFormDate(dateValue);
    if (dateMs === null) return UNKNOWN;

    const period = findPeriodForDate(periods, dateMs);
    if (!period) return OPEN;
    if (!isPeriodBlocked(period)) return { status: 'open', period, message: null };

    const reason = period.status === 'CLOSED' ? 'closed' : 'locked';
    return {
        status: 'blocked',
        period,
        message: `Accounting period "${period.name}" is ${reason}. This document cannot be posted on ${dateValue}. Choose a date in an open period, or reopen the period in Company Setup.`,
    };
}
