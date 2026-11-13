import { z } from 'zod';
export const bpjsRulesSchema = z.object({
  kesehatan: z.object({
    employee: z.number().min(0).max(1),
    employer: z.number().min(0).max(1),
    ceiling: z.number().positive(),
    floor: z.number().nonnegative().default(0),
  }),
  jht: z.object({
    employee: z.number().min(0).max(1),
    employer: z.number().min(0).max(1),
  }),
  jp: z.object({
    employee: z.number().min(0).max(1),
    employer: z.number().min(0).max(1),
    ceiling: z.number().positive(),
  }),
  jkk: z.object({
    employer: z.union([
      z.literal(0.0024),
      z.literal(0.0054),
      z.literal(0.0089),
      z.literal(0.0127),
      z.literal(0.0174),
    ]),
  }),
  jkm: z.object({ employer: z.number().min(0).max(1) }),
});
export const payrollRulesSchema = z.object({
  bpjs: bpjsRulesSchema,
  holidays: z
    .array(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(
          (v) =>
            Number.isFinite(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v,
          'Invalid holiday date',
        ),
    )
    .max(400)
    .default([]),
  shortWorkday: z.number().int().min(1).max(6).default(6),
});
export type BPJSRules = z.infer<typeof bpjsRulesSchema>;
export type PayrollRules = z.infer<typeof payrollRulesSchema>;
export type OvertimeDay = {
  date: string;
  hours: number;
  kind: 'WORKDAY' | 'REST' | 'HOLIDAY' | 'SHORT_HOLIDAY';
};
export type PTKPStatus =
  | 'TK/0'
  | 'TK/1'
  | 'TK/2'
  | 'TK/3'
  | 'K/0'
  | 'K/1'
  | 'K/2'
  | 'K/3';
export function terCategory(status: PTKPStatus): 'A' | 'B' | 'C' {
  if (['TK/0', 'TK/1', 'K/0'].includes(status)) return 'A';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(status)) return 'B';
  if (status === 'K/3') return 'C';
  throw new Error('Select a valid PTKP status.');
}
export function ptkpAmount(status: PTKPStatus) {
  terCategory(status);
  return (
    54_000_000 +
    (status.startsWith('K/') ? 4_500_000 : 0) +
    Number(status.at(-1)) * 4_500_000
  );
}
/** Ordinary resident employees: actual employer YTD income, not annualised on resignation. */
export function annualPPh21(
  gross: number,
  employeeJhtJp: number,
  status: PTKPStatus,
  employmentMonths = 12,
) {
  const jobExpense = Math.min(
    Math.max(gross, 0) * 0.05,
    6_000_000,
    Math.max(0, Math.min(employmentMonths, 12)) * 500_000,
  );
  const taxable =
    Math.floor(
      Math.max(0, gross - jobExpense - employeeJhtJp - ptkpAmount(status)) /
        1000,
    ) * 1000;
  let left = taxable,
    tax = 0;
  for (const [width, rate] of [
    [60_000_000, 0.05],
    [190_000_000, 0.15],
    [250_000_000, 0.25],
    [4_500_000_000, 0.3],
    [Infinity, 0.35],
  ]) {
    const amount = Math.min(left, width);
    tax += amount * rate;
    left -= amount;
    if (left <= 0) break;
  }
  return {
    tax: Math.round(tax),
    taxable,
    jobExpense,
    ptkp: ptkpAmount(status),
    employeeJhtJp,
  };
}
export function overtimePay(
  basic: number,
  fixed: number,
  variable: number,
  days: OvertimeDay[],
  weekDays = 5,
) {
  const base = Math.max(
    basic + fixed,
    variable > 0 ? 0.75 * (basic + fixed + variable) : 0,
  );
  let weighted = 0;
  const seen = new Set<string>();
  const weeks = new Map<string, number>();
  for (const d of days) {
    if (seen.has(d.date))
      throw new Error('Overtime must be aggregated once per employee/day.');
    seen.add(d.date);
    if (!Number.isFinite(d.hours) || d.hours < 0)
      throw new Error('Invalid overtime hours.');
    let h = d.hours;
    if (d.kind === 'WORKDAY') {
      if (h > 4)
        throw new Error(
          `${d.date}: workday overtime exceeds 4 hours; review the daily record.`,
        );
      const date = new Date(d.date + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const key = date.toISOString().slice(0, 10),
        total = (weeks.get(key) || 0) + h;
      weeks.set(key, total);
      if (total > 18)
        throw new Error(
          `${key}: workday overtime exceeds 18 hours/week; review attendance.`,
        );
      weighted += Math.min(h, 1) * 1.5 + Math.max(h - 1, 0) * 2;
    } else {
      const first =
        d.kind === 'SHORT_HOLIDAY' && weekDays === 6
          ? 5
          : weekDays === 6
            ? 7
            : 8;
      if (h > first + 4)
        throw new Error(
          `${d.date}: rest/holiday overtime exceeds the supported statutory bands; review attendance.`,
        );
      weighted +=
        Math.min(h, first) * 2 +
        Math.min(Math.max(h - first, 0), 1) * 3 +
        Math.max(h - first - 1, 0) * 4;
    }
  }
  return Math.round((base / 173) * weighted);
}
export function employmentWindow(
  employee: { joinDate: Date; employmentEndDate?: Date | null },
  start: Date,
  end: Date,
) {
  const from = new Date(Math.max(employee.joinDate.getTime(), start.getTime()));
  const to = new Date(
    Math.min(
      employee.employmentEndDate?.getTime() ?? end.getTime(),
      end.getTime(),
    ),
  );
  return from <= to ? { from, to } : null;
}
export function policyCoversMarchCycle(from: Date, until: Date) {
  const cycle =
    from.getUTCMonth() < 2 ? from.getUTCFullYear() - 1 : from.getUTCFullYear();
  return until >= from && until < new Date(Date.UTC(cycle + 1, 2, 1));
}
