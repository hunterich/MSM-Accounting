import { describe, it, expect } from 'vitest';
import {
  summarizePayrollAttendance,
  type PaidLeave,
} from '../payroll-attendance';
const day = (value: string) => new Date(value + 'T00:00:00Z');
const leave = (
  category: string,
  isPaid?: boolean | null,
  status = 'APPROVED',
): PaidLeave => ({
  startDate: day('2026-10-05'),
  endDate: day('2026-10-09'),
  status,
  leaveType: { category, isPaid },
});
const summarize = (leaves: PaidLeave[], recorded = false) =>
  summarizePayrollAttendance(
    day('2026-10-05'),
    day('2026-10-09'),
    recorded ? [{ date: day('2026-10-05'), status: 'LEAVE' }] : [],
    leaves,
  );
describe('approved leave payroll attendance', () => {
  for (const category of ['ANNUAL', 'MATERNITY', 'PATERNITY', 'SICK'])
    for (const recorded of [false, true])
      it(
        category +
          ' pays scheduled days with ' +
          (recorded ? 'LEAVE' : 'no') +
          ' attendance records',
        () => {
          expect(summarize([leave(category)], recorded)).toMatchObject({
            workingDays: 5,
            presentDays: 0,
            paidDays: 5,
            sickDays: category === 'SICK' ? 5 : 0,
            leaveDays: category === 'SICK' ? 0 : 5,
            absentDays: 0,
            issues: [],
          });
        },
      );
  it('OTHER follows its explicit paid or unpaid classification', () => {
    expect(summarize([leave('OTHER', true)])).toMatchObject({
      paidDays: 5,
      leaveDays: 5,
      presentDays: 0,
      issues: [],
    });
    expect(summarize([leave('OTHER', false)])).toMatchObject({
      paidDays: 0,
      absentDays: 5,
      issues: [],
    });
  });
  it('legacy OTHER needs classification, never fabricated attendance', () => {
    const result = summarize([leave('OTHER', null)]);
    expect(result.paidDays).toBe(0);
    expect(result.issues).toHaveLength(5);
    expect(result.issues.every((i) => i.includes('OTHER leave needs'))).toBe(
      true,
    );
    expect(result.issues.join()).not.toContain('missing attendance');
  });
  it('UNPAID remains unpaid and pending leave remains unapproved', () => {
    expect(summarize([leave('UNPAID')])).toMatchObject({
      paidDays: 0,
      absentDays: 5,
      issues: [],
    });
    expect(
      summarize([leave('MATERNITY', undefined, 'PENDING')]).issues,
    ).toHaveLength(5);
  });
  it('different approved categories still conflict and do not double-count', () => {
    const result = summarize([leave('MATERNITY'), leave('ANNUAL')]);
    expect(result.paidDays).toBe(0);
    expect(result.issues).toEqual(
      Array.from(
        { length: 5 },
        (_, i) =>
          '2026-10-0' + (5 + i) + ': conflicting approved leave categories',
      ),
    );
  });
  it('conflicting OTHER payment classifications require review', () => {
    expect(
      summarize([leave('OTHER', true), leave('OTHER', false)]).issues,
    ).toHaveLength(5);
  });
});
