/** Pure domain helpers for the POS Sales Performance report. No DB, no I/O —
 *  so month-boundary and rollup logic is unit-testable in isolation. */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta is UTC+7, no DST
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Sentinel key for line value whose performer is unknown (no explicit
 *  performer and the cashier has no linked staff record). */
export const UNASSIGNED = 'UNASSIGNED';

export type PerfStatus = 'green' | 'amber' | 'red' | null;

export interface MonthRange {
  start: Date;        // UTC instant of WIB month start (inclusive)
  end: Date;          // UTC instant of next WIB month start (exclusive)
  daysInMonth: number;
  daysElapsed: number; // relative to `now`, clamped to [0, daysInMonth]
}

export interface PerfRow {
  employeeId: string | null; // null => the Unassigned bucket
  name: string;
  target: number;            // 0 when none set
  hasTarget: boolean;
  sold: number;
  remaining: number;         // max(0, target - sold); 0 when no target
  pct: number | null;        // null when no target
  status: PerfStatus;
}

export interface PerfResult {
  rows: PerfRow[];
  totals: { target: number; sold: number };
}

/** WIB calendar month for "YYYY-MM", expressed as UTC instants. */
export function wibMonthRange(month: string, now: Date): MonthRange {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const year = Number(m[1]);
  const mon = Number(m[2]); // 1-12
  if (mon < 1 || mon > 12) throw new Error(`Invalid month "${month}"`);

  // Date.UTC(y, mon-1, 1) is UTC midnight; WIB midnight is 7h earlier in UTC.
  const start = new Date(Date.UTC(year, mon - 1, 1) - WIB_OFFSET_MS);
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const end = new Date(Date.UTC(nextYear, nextMon - 1, 1) - WIB_OFFSET_MS);

  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  let daysElapsed: number;
  if (now.getTime() >= end.getTime()) daysElapsed = daysInMonth;
  else if (now.getTime() < start.getTime()) daysElapsed = 0;
  else daysElapsed = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;

  return { start, end, daysInMonth, daysElapsed };
}

/** Colour by pace so mid-month numbers are meaningful. `expected` is the
 *  pro-rated target for the elapsed portion of the month. */
export function saleTargetStatus(sold: number, target: number, expected: number): PerfStatus {
  if (target <= 0) return null;
  if (sold >= target || sold >= expected) return 'green';
  if (sold >= 0.9 * expected) return 'amber';
  return 'red';
}

export function computeSalesPerformance(input: {
  soldByEmployee: Record<string, number>; // keys: employeeId, or UNASSIGNED
  targets: Record<string, number>;         // employeeId -> amount (>0)
  names: Record<string, string>;           // employeeId -> display name
  daysInMonth: number;
  daysElapsed: number;
}): PerfResult {
  const { soldByEmployee, targets, names, daysInMonth, daysElapsed } = input;
  const paceFrac = daysInMonth > 0 ? daysElapsed / daysInMonth : 0;

  const ids = new Set<string>();
  for (const k of Object.keys(soldByEmployee)) if (k !== UNASSIGNED) ids.add(k);
  for (const k of Object.keys(targets)) ids.add(k);

  const rows: PerfRow[] = [];
  for (const id of ids) {
    const sold = round2(soldByEmployee[id] ?? 0);
    const target = targets[id] ?? 0;
    const hasTarget = target > 0;
    const expected = target * paceFrac;
    rows.push({
      employeeId: id,
      name: names[id] ?? 'Unknown',
      target,
      hasTarget,
      sold,
      remaining: hasTarget ? Math.max(0, round2(target - sold)) : 0,
      pct: hasTarget ? round2((sold / target) * 100) : null,
      status: saleTargetStatus(sold, target, expected),
    });
  }
  rows.sort((a, b) => b.sold - a.sold);

  const unassignedSold = round2(soldByEmployee[UNASSIGNED] ?? 0);
  if (unassignedSold > 0) {
    rows.push({
      employeeId: null, name: 'Unassigned', target: 0, hasTarget: false,
      sold: unassignedSold, remaining: 0, pct: null, status: null,
    });
  }

  return {
    rows,
    totals: {
      target: round2(rows.reduce((s, r) => s + r.target, 0)),
      sold: round2(rows.reduce((s, r) => s + r.sold, 0)),
    },
  };
}
