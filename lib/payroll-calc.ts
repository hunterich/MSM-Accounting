/**
 * Indonesian Payroll Calculation Utilities
 * PPh 21 TER (Tarif Efektif Rata-rata) 2024 & BPJS rates
 */

// ── PPh 21 TER Brackets ─────────────────────────────────────────────────────
// Category A: TK/0, TK/1 (single, no/1 dependent)
// Category B: TK/2, TK/3, K/0, K/1 (single 2-3 dep, married 0-1 dep)
// Category C: K/2, K/3 (married 2-3 dependents)

interface TERBracket {
  upTo: number;
  rate: number;
}

const TER_CATEGORY_A: TERBracket[] = [
  { upTo: 5_400_000, rate: 0 },
  { upTo: 5_650_000, rate: 0.0025 },
  { upTo: 5_950_000, rate: 0.005 },
  { upTo: 6_300_000, rate: 0.0075 },
  { upTo: 6_750_000, rate: 0.01 },
  { upTo: 7_500_000, rate: 0.0125 },
  { upTo: 8_550_000, rate: 0.015 },
  { upTo: 9_650_000, rate: 0.0175 },
  { upTo: 10_050_000, rate: 0.02 },
  { upTo: 10_350_000, rate: 0.0225 },
  { upTo: 10_700_000, rate: 0.025 },
  { upTo: 11_050_000, rate: 0.03 },
  { upTo: 11_600_000, rate: 0.035 },
  { upTo: 12_500_000, rate: 0.04 },
  { upTo: 13_750_000, rate: 0.05 },
  { upTo: 15_100_000, rate: 0.06 },
  { upTo: 16_950_000, rate: 0.07 },
  { upTo: 19_750_000, rate: 0.08 },
  { upTo: 24_150_000, rate: 0.09 },
  { upTo: 26_450_000, rate: 0.10 },
  { upTo: 28_000_000, rate: 0.11 },
  { upTo: 30_050_000, rate: 0.12 },
  { upTo: 32_400_000, rate: 0.13 },
  { upTo: 35_400_000, rate: 0.14 },
  { upTo: 39_100_000, rate: 0.15 },
  { upTo: 43_850_000, rate: 0.16 },
  { upTo: 47_800_000, rate: 0.17 },
  { upTo: 51_400_000, rate: 0.18 },
  { upTo: 56_300_000, rate: 0.19 },
  { upTo: 62_200_000, rate: 0.20 },
  { upTo: 68_600_000, rate: 0.21 },
  { upTo: 77_500_000, rate: 0.22 },
  { upTo: 89_000_000, rate: 0.23 },
  { upTo: 103_000_000, rate: 0.24 },
  { upTo: 125_000_000, rate: 0.25 },
  { upTo: 157_000_000, rate: 0.26 },
  { upTo: 206_000_000, rate: 0.27 },
  { upTo: 337_000_000, rate: 0.28 },
  { upTo: 454_000_000, rate: 0.29 },
  { upTo: 550_000_000, rate: 0.30 },
  { upTo: 695_000_000, rate: 0.31 },
  { upTo: 910_000_000, rate: 0.32 },
  { upTo: 1_400_000_000, rate: 0.33 },
  { upTo: Infinity, rate: 0.34 },
];

const TER_CATEGORY_B: TERBracket[] = [
  { upTo: 6_200_000, rate: 0 },
  { upTo: 6_500_000, rate: 0.0025 },
  { upTo: 6_850_000, rate: 0.005 },
  { upTo: 7_300_000, rate: 0.0075 },
  { upTo: 9_200_000, rate: 0.01 },
  { upTo: 10_750_000, rate: 0.015 },
  { upTo: 11_250_000, rate: 0.02 },
  { upTo: 11_600_000, rate: 0.025 },
  { upTo: 12_600_000, rate: 0.03 },
  { upTo: 13_600_000, rate: 0.04 },
  { upTo: 14_950_000, rate: 0.05 },
  { upTo: 16_400_000, rate: 0.06 },
  { upTo: 18_450_000, rate: 0.07 },
  { upTo: 21_850_000, rate: 0.08 },
  { upTo: 26_000_000, rate: 0.09 },
  { upTo: 27_700_000, rate: 0.10 },
  { upTo: 29_350_000, rate: 0.11 },
  { upTo: 31_450_000, rate: 0.12 },
  { upTo: 33_950_000, rate: 0.13 },
  { upTo: 37_100_000, rate: 0.14 },
  { upTo: 41_100_000, rate: 0.15 },
  { upTo: 45_800_000, rate: 0.16 },
  { upTo: 49_500_000, rate: 0.17 },
  { upTo: 53_800_000, rate: 0.18 },
  { upTo: 58_500_000, rate: 0.19 },
  { upTo: 64_000_000, rate: 0.20 },
  { upTo: 71_000_000, rate: 0.21 },
  { upTo: 80_000_000, rate: 0.22 },
  { upTo: 93_000_000, rate: 0.23 },
  { upTo: 109_000_000, rate: 0.24 },
  { upTo: 129_000_000, rate: 0.25 },
  { upTo: 163_000_000, rate: 0.26 },
  { upTo: 211_000_000, rate: 0.27 },
  { upTo: 374_000_000, rate: 0.28 },
  { upTo: 459_000_000, rate: 0.29 },
  { upTo: 555_000_000, rate: 0.30 },
  { upTo: 704_000_000, rate: 0.31 },
  { upTo: 957_000_000, rate: 0.32 },
  { upTo: 1_405_000_000, rate: 0.33 },
  { upTo: Infinity, rate: 0.34 },
];

const TER_CATEGORY_C: TERBracket[] = [
  { upTo: 6_600_000, rate: 0 },
  { upTo: 6_950_000, rate: 0.0025 },
  { upTo: 7_350_000, rate: 0.005 },
  { upTo: 7_800_000, rate: 0.0075 },
  { upTo: 8_850_000, rate: 0.01 },
  { upTo: 9_800_000, rate: 0.0125 },
  { upTo: 10_950_000, rate: 0.015 },
  { upTo: 11_200_000, rate: 0.02 },
  { upTo: 12_050_000, rate: 0.025 },
  { upTo: 12_950_000, rate: 0.03 },
  { upTo: 14_150_000, rate: 0.04 },
  { upTo: 15_550_000, rate: 0.05 },
  { upTo: 17_050_000, rate: 0.06 },
  { upTo: 19_500_000, rate: 0.07 },
  { upTo: 22_700_000, rate: 0.08 },
  { upTo: 25_700_000, rate: 0.09 },
  { upTo: 27_700_000, rate: 0.10 },
  { upTo: 30_100_000, rate: 0.11 },
  { upTo: 32_600_000, rate: 0.12 },
  { upTo: 35_400_000, rate: 0.13 },
  { upTo: 38_900_000, rate: 0.14 },
  { upTo: 43_000_000, rate: 0.15 },
  { upTo: 47_000_000, rate: 0.16 },
  { upTo: 51_000_000, rate: 0.17 },
  { upTo: 55_800_000, rate: 0.18 },
  { upTo: 61_400_000, rate: 0.19 },
  { upTo: 67_900_000, rate: 0.20 },
  { upTo: 76_500_000, rate: 0.21 },
  { upTo: 85_000_000, rate: 0.22 },
  { upTo: 98_000_000, rate: 0.23 },
  { upTo: 116_000_000, rate: 0.24 },
  { upTo: 137_000_000, rate: 0.25 },
  { upTo: 171_000_000, rate: 0.26 },
  { upTo: 220_000_000, rate: 0.27 },
  { upTo: 390_000_000, rate: 0.28 },
  { upTo: 463_000_000, rate: 0.29 },
  { upTo: 561_000_000, rate: 0.30 },
  { upTo: 709_000_000, rate: 0.31 },
  { upTo: 965_000_000, rate: 0.32 },
  { upTo: 1_419_000_000, rate: 0.33 },
  { upTo: Infinity, rate: 0.34 },
];

const TER_TABLES: Record<string, TERBracket[]> = {
  A: TER_CATEGORY_A,
  B: TER_CATEGORY_B,
  C: TER_CATEGORY_C,
};

/**
 * Calculate monthly PPh 21 using TER (Tarif Efektif Rata-rata) method.
 * @param grossMonthly - Gross monthly income (bruto)
 * @param category - TER category: 'A' (TK/0,TK/1), 'B' (TK/2,TK/3,K/0,K/1), 'C' (K/2,K/3)
 * @returns Monthly PPh 21 amount
 */
export function calculatePPh21TER(grossMonthly: number, category: 'A' | 'B' | 'C' = 'A'): number {
  if (grossMonthly <= 0) return 0;

  const brackets = TER_TABLES[category];
  for (const bracket of brackets) {
    if (grossMonthly <= bracket.upTo) {
      return Math.round(grossMonthly * bracket.rate);
    }
  }
  // Should never reach here due to Infinity bracket
  return Math.round(grossMonthly * 0.34);
}

// ── BPJS Rates (2024 Indonesian standard) ────────────────────────────────────

export const BPJS_RATES = {
  kesehatan: { employee: 0.01, employer: 0.04, ceiling: 12_000_000 },
  jht: { employee: 0.02, employer: 0.037 },
  jp: { employee: 0.01, employer: 0.02, ceiling: 10_042_300 },
  jkk: { employer: 0.0024 }, // risk level 1
  jkm: { employer: 0.003 },
};

export interface BPJSBreakdown {
  kesehatan: number;
  jht: number;
  jp: number;
  jkk: number;
  jkm: number;
  total: number;
}

export interface BPJSResult {
  employee: BPJSBreakdown;
  employer: BPJSBreakdown;
}

/**
 * Calculate BPJS contributions for employee and employer.
 * @param basicSalary - Monthly basic salary
 * @returns Employee and employer BPJS breakdowns
 */
export function calculateBPJS(basicSalary: number): BPJSResult {
  // BPJS Kesehatan - capped at ceiling
  const kesBasis = Math.min(basicSalary, BPJS_RATES.kesehatan.ceiling);
  const kesEmployee = Math.round(kesBasis * BPJS_RATES.kesehatan.employee);
  const kesEmployer = Math.round(kesBasis * BPJS_RATES.kesehatan.employer);

  // BPJS JHT - no ceiling
  const jhtEmployee = Math.round(basicSalary * BPJS_RATES.jht.employee);
  const jhtEmployer = Math.round(basicSalary * BPJS_RATES.jht.employer);

  // BPJS JP - capped at ceiling
  const jpBasis = Math.min(basicSalary, BPJS_RATES.jp.ceiling);
  const jpEmployee = Math.round(jpBasis * BPJS_RATES.jp.employee);
  const jpEmployer = Math.round(jpBasis * BPJS_RATES.jp.employer);

  // JKK & JKM - employer only
  const jkkEmployer = Math.round(basicSalary * BPJS_RATES.jkk.employer);
  const jkmEmployer = Math.round(basicSalary * BPJS_RATES.jkm.employer);

  const employee: BPJSBreakdown = {
    kesehatan: kesEmployee,
    jht: jhtEmployee,
    jp: jpEmployee,
    jkk: 0,
    jkm: 0,
    total: kesEmployee + jhtEmployee + jpEmployee,
  };

  const employer: BPJSBreakdown = {
    kesehatan: kesEmployer,
    jht: jhtEmployer,
    jp: jpEmployer,
    jkk: jkkEmployer,
    jkm: jkmEmployer,
    total: kesEmployer + jhtEmployer + jpEmployer + jkkEmployer + jkmEmployer,
  };

  return { employee, employer };
}

// ── Payroll Line Calculator ──────────────────────────────────────────────────

export interface AttendanceSummary {
  workingDays: number;
  presentDays: number;
  absentDays: number;
  sickDays: number;
  leaveDays: number;
}

export interface EmployeePayData {
  basicSalary: number;
  allowances: number;
  deductions: number;
}

export interface PayrollLineCalc {
  basicSalary: number;
  totalAllowances: number;
  totalDeductions: number;
  overtimePay: number;
  grossPay: number;
  bpjs: BPJSResult;
  pph21: number;
  totalBpjsEmployee: number;
  totalBpjsEmployer: number;
  netPay: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  overtimeHours: number;
}

/**
 * Calculate a single payroll line for an employee.
 * @param employee - Employee pay data
 * @param attendance - Attendance summary for the period
 * @param overtimeHours - Total overtime hours
 * @param pph21Category - PPh 21 TER category (default 'A')
 * @returns Complete payroll line calculation
 */
export function calculatePayrollLine(
  employee: EmployeePayData,
  attendance: AttendanceSummary,
  overtimeHours: number,
  pph21Category: 'A' | 'B' | 'C' = 'A',
): PayrollLineCalc {
  const { basicSalary, allowances, deductions } = employee;

  // Prorate salary based on attendance if there are absent days
  const attendanceRatio = attendance.workingDays > 0
    ? attendance.presentDays / attendance.workingDays
    : 1;

  const proratedSalary = Math.round(basicSalary * attendanceRatio);

  // Overtime pay: 1/173 of monthly salary * 1.5 per hour (Indonesian labor law)
  const hourlyRate = basicSalary / 173;
  const overtimePay = Math.round(overtimeHours * hourlyRate * 1.5);

  // Gross pay
  const grossPay = proratedSalary + allowances + overtimePay;

  // BPJS based on basic salary (not gross)
  const bpjs = calculateBPJS(basicSalary);

  // PPh 21 on gross minus employee BPJS contributions
  const taxableIncome = grossPay - bpjs.employee.total;
  const pph21 = calculatePPh21TER(taxableIncome, pph21Category);

  // Net pay
  const netPay = grossPay - deductions - bpjs.employee.total - pph21;

  return {
    basicSalary: proratedSalary,
    totalAllowances: allowances,
    totalDeductions: deductions,
    overtimePay,
    grossPay,
    bpjs,
    pph21,
    totalBpjsEmployee: bpjs.employee.total,
    totalBpjsEmployer: bpjs.employer.total,
    netPay,
    workingDays: attendance.workingDays,
    presentDays: attendance.presentDays,
    absentDays: attendance.absentDays,
    overtimeHours,
  };
}
