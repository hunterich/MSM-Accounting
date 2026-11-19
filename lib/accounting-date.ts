/**
 * The accounting date — one convention for every journal.
 *
 * An entry's accounting date is the company's business day (Asia/Jakarta),
 * stored the same way date-only documents already are: 00:00 UTC of that day.
 * Posting, period locks and reports all read dates this way:
 *
 *  - Postings stamp `JournalEntry.date` with `toAccountingDate(...)`. A date-only
 *    document date (already 00:00 UTC) passes through unchanged; a clock time
 *    (POS sale, settlement import, CSV opening import) becomes the business day
 *    it happened on. The clock time itself stays on `postedAt` for audit.
 *  - Period locks (`lib/period-guard.ts`) normalize the posting date the same way
 *    before comparing it to `AccountingPeriod` boundaries, so 02:00 WIB on the 1st
 *    belongs to the new month there too, not to the month before.
 *  - Reports filter with `reportDate` (Jakarta day bounds), which contain the
 *    00:00 UTC stamp of the same day — so a report and a period lock never
 *    disagree about which month an entry is in.
 *
 * Reports hard-code Asia/Jakarta (see `reportDate`), so this does too: the
 * accounting date must match the day reports put an entry on.
 */
export const ACCOUNTING_TIME_ZONE = 'Asia/Jakarta';

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACCOUNTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The business day an instant falls on, as `YYYY-MM-DD`. */
export function accountingDay(instant: Date = new Date()): string {
  if (Number.isNaN(instant.getTime())) throw new Error('accountingDay: invalid date');
  const parts = DAY_FORMAT.formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The accounting date of an instant: 00:00 UTC of its business day.
 * Idempotent — a value that is already an accounting date comes back equal.
 */
export function toAccountingDate(instant: Date = new Date()): Date {
  return new Date(`${accountingDay(instant)}T00:00:00.000Z`);
}

/**
 * Instant bounds (inclusive) that hold every journal whose accounting date lies
 * in `[startDate, endDate]`, where both are period/year boundaries.
 *
 * Use this when filtering stored dates by a period or fiscal year. For a date
 * stored on the convention (00:00 UTC) it selects exactly what a UTC-boundary
 * filter would; for an older clock-time posting it selects by business day, the
 * way reports and the period lock see it.
 */
export function accountingRangeBounds(startDate: Date, endDate: Date): { gte: Date; lte: Date } {
  const startDay = startDate.toISOString().slice(0, 10);
  const endDay = endDate.toISOString().slice(0, 10);
  const gte = new Date(`${startDay}T00:00:00.000+07:00`);
  const lte = new Date(new Date(`${endDay}T00:00:00.000+07:00`).getTime() + 86_400_000 - 1);
  return { gte, lte };
}
