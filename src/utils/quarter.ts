// Pure quarter-math helpers for the Best Selling Products dashboard widget.
// `quarter` is 1-based (1 = Q1 = Jan–Mar … 4 = Q4 = Oct–Dec).

export interface Quarter {
    year: number;
    quarter: number;
}

/** The calendar quarter that `now` falls in (defaults to today). */
export function currentQuarter(now: Date = new Date()): Quarter {
    return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 };
}

/** First and last calendar day of a quarter, as `YYYY-MM-DD` strings. */
export function quarterRange(year: number, quarter: number): { dateFrom: string; dateTo: string } {
    const startMonth = (quarter - 1) * 3;             // 0, 3, 6, 9
    const from = new Date(year, startMonth, 1);
    const to = new Date(year, startMonth + 3, 0);     // day 0 of next month = last day of the quarter
    return { dateFrom: toISODate(from), dateTo: toISODate(to) };
}

/** Step `delta` quarters forward/back, rolling the year over at Q1↔Q4. */
export function stepQuarter(year: number, quarter: number, delta: number): Quarter {
    const idx = year * 4 + (quarter - 1) + delta;
    return { year: Math.floor(idx / 4), quarter: (idx % 4) + 1 };
}

/** Human label, e.g. "Q2 2026". */
export function formatQuarterLabel(year: number, quarter: number): string {
    return `Q${quarter} ${year}`;
}

function toISODate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
