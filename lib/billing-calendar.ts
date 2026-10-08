import { dateInTimezone } from './purchase-order-auto-close-config';

/** Templates store date-only values at UTC midnight; compare business-day labels. */
export function billingDay(now = new Date(), timezone = 'Asia/Jakarta'): Date {
  return new Date(`${dateInTimezone(now, timezone)}T00:00:00Z`);
}

export function businessDayStart(day: string, timezone: string): Date {
  const target = new Date(`${day}T00:00:00Z`).getTime();
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const n = (type: string) => Number(parts.find(p => p.type === type)!.value);
    const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    instant += target - local;
  }
  return new Date(instant);
}

export function nextRecurringDate(current: Date, frequency: string, dayOfMonth?: number | null): Date {
  const next = new Date(current);
  if (frequency === 'DAILY' || frequency === 'WEEKLY') {
    next.setUTCDate(next.getUTCDate() + (frequency === 'DAILY' ? 1 : 7));
    return next;
  }
  const months = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 }[frequency];
  if (!months) throw new Error(`Unsupported recurring frequency: ${frequency}`);
  const day = dayOfMonth ?? current.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}
