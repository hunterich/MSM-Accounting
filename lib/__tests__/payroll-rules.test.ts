import { describe, it, expect } from 'vitest';
import {
  annualPPh21,
  terCategory,
  overtimePay,
  employmentWindow,
  policyCoversMarchCycle,
} from '../payroll-rules';
import { calculatePayrollLine, calculateBPJS } from '../payroll-calc';
import { TEST_BPJS } from './payroll-fixtures';
const day = (s: string) => new Date(s + 'T00:00:00Z');
describe('PTKP and annual/final reconciliation', () => {
  it.each([
    ['TK/0', 'A'],
    ['TK/1', 'A'],
    ['K/0', 'A'],
    ['TK/2', 'B'],
    ['TK/3', 'B'],
    ['K/1', 'B'],
    ['K/2', 'B'],
    ['K/3', 'C'],
  ] as const)('%s maps to category %s', (s, c) =>
    expect(terCategory(s)).toBe(c),
  );
  it('deducts job expense and employee JHT/JP only in annual Article 17 calculation', () => {
    expect(annualPPh21(150_000_000, 4_500_000, 'TK/0')).toEqual({
      tax: 6_825_000,
      taxable: 85_500_000,
      jobExpense: 6_000_000,
      ptkp: 54_000_000,
      employeeJhtJp: 4_500_000,
    });
  });
  it('prorates the job-expense cap to employment months and permits a final withholding refund', () => {
    const a = annualPPh21(140_000_000, 0, 'TK/0', 8);
    expect(a.jobExpense).toBe(4_000_000);
    expect(a.tax).toBe(6_300_000);
    expect(a.tax - 9_800_000).toBe(-3_500_000);
  });
  it('rounds taxable income down to 1,000 and respects higher PTKP', () => {
    expect(annualPPh21(80_000_999, 0, 'K/3').taxable).toBe(4_000_000);
    expect(annualPPh21(30_000_000, 0, 'TK/0').tax).toBe(0);
  });
});
describe('daily PP 35 overtime', () => {
  const d = (
    date: string,
    hours: number,
    kind: 'WORKDAY' | 'REST' | 'HOLIDAY' | 'SHORT_HOLIDAY',
  ) => ({ date, hours, kind });
  it('starts the 1.5x first hour anew every workday', () => {
    expect(
      overtimePay(1_730_000, 0, 0, [
        d('2026-10-05', 2, 'WORKDAY'),
        d('2026-10-06', 2, 'WORKDAY'),
      ]),
    ).toBe(70_000);
  });
  it('includes fixed allowances in the 1/173 base', () =>
    expect(
      overtimePay(1_000_000, 730_000, 0, [d('2026-10-05', 2, 'WORKDAY')]),
    ).toBe(35_000));
  it('uses the statutory 75% floor when variable allowances dominate wages', () =>
    expect(
      overtimePay(1_000_000, 0, 1_000_000, [d('2026-10-05', 2, 'WORKDAY')]),
    ).toBe(Math.round((1_500_000 / 173) * 3.5)));
  it('uses different 5-day, 6-day and shortest-holiday bands', () => {
    expect(overtimePay(1_730_000, 0, 0, [d('2026-10-04', 10, 'REST')], 5)).toBe(
      230_000,
    );
    expect(overtimePay(1_730_000, 0, 0, [d('2026-10-04', 9, 'REST')], 6)).toBe(
      210_000,
    );
    expect(
      overtimePay(1_730_000, 0, 0, [d('2026-10-03', 7, 'SHORT_HOLIDAY')], 6),
    ).toBe(170_000);
  });
  it('refuses ambiguous duplicates and excessive daily overtime', () => {
    expect(() =>
      overtimePay(1_000_000, 0, 0, [d('2026-10-05', 5, 'WORKDAY')]),
    ).toThrow('4 hours');
    expect(() =>
      overtimePay(1_000_000, 0, 0, [
        d('2026-10-05', 1, 'WORKDAY'),
        d('2026-10-05', 1, 'WORKDAY'),
      ]),
    ).toThrow('once');
  });
});
describe('dated BPJS and employment eligibility', () => {
  it('uses basic plus fixed allowances, not the cash proration or variable allowance', () => {
    const c = calculatePayrollLine(
      {
        basicSalary: 8_000_000,
        fixedAllowances: 2_000_000,
        allowances: 3_000_000,
        deductions: 0,
      },
      {
        workingDays: 20,
        presentDays: 10,
        paidDays: 10,
        sickDays: 0,
        leaveDays: 0,
        absentDays: 10,
      },
      [],
      'A',
      TEST_BPJS,
    );
    expect(c.basicSalary).toBe(4_000_000);
    expect(c.totalAllowances).toBe(2_000_000);
    expect(c.bpjs.employee.jht).toBe(200_000);
  });
  it('accepts changed JP ceilings and JKK risk in the selected dated policy', () => {
    expect(calculateBPJS(20_000_000, TEST_BPJS).employee.jp).toBe(100_423);
    const later = {
      ...TEST_BPJS,
      jp: { ...TEST_BPJS.jp, ceiling: 11_086_300 },
      jkk: { employer: 0.0174 as const },
    };
    expect(calculateBPJS(20_000_000, later).employee.jp).toBe(110_863);
    expect(calculateBPJS(20_000_000, later).employer.jkk).toBe(348_000);
  });
  it('does not repeat BPJS on an off-cycle earning run', () => {
    const c = calculatePayrollLine(
      {
        basicSalary: 0,
        allowances: 0,
        extraEarnings: 2_000_000,
        deductions: 0,
      },
      {
        workingDays: 0,
        presentDays: 0,
        paidDays: 0,
        sickDays: 0,
        leaveDays: 0,
        absentDays: 0,
      },
      [],
      'A',
      { ...TEST_BPJS, kesehatan: { ...TEST_BPJS.kesehatan, floor: 5_000_000 } },
      false,
    );
    expect(c.grossPay).toBe(2_000_000);
    expect(c.totalBpjsEmployee + c.totalBpjsEmployer).toBe(0);
  });
  it('includes the last working day and excludes later payroll months', () => {
    const employee = {
      joinDate: day('2026-10-15'),
      employmentEndDate: day('2026-10-20'),
    };
    expect(
      employmentWindow(employee, day('2026-10-01'), day('2026-10-31')),
    ).toEqual({ from: employee.joinDate, to: employee.employmentEndDate });
    expect(
      employmentWindow(employee, day('2026-11-01'), day('2026-11-30')),
    ).toBeNull();
  });
  it('requires a fresh JP policy at the next March boundary', () => {
    expect(policyCoversMarchCycle(day('2026-03-01'), day('2027-02-28'))).toBe(
      true,
    );
    expect(policyCoversMarchCycle(day('2026-03-01'), day('2027-03-01'))).toBe(
      false,
    );
  });
});
