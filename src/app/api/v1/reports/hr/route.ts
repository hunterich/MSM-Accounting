import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, ApiError } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asMoney = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const startOfDay = (value: string | null): Date => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value: string | null): Date => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  date.setHours(23, 59, 59, 999);
  return date;
};

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'pph21-summary';

  if (type === 'pph21-summary') {
    const dateFrom = startOfDay(searchParams.get('dateFrom'));
    const dateTo = endOfDay(searchParams.get('dateTo'));

    if (dateFrom > dateTo) {
      return err('dateFrom must be before or equal to dateTo', 400);
    }

    const payrollRuns = await prisma.payrollRun.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['COMPLETED', 'POSTED'] },
        periodStart: { lte: dateTo },
        periodEnd: { gte: dateFrom },
      },
      include: {
        lines: {
          include: {
            employee: {
              select: {
                id: true,
                employeeNo: true,
                name: true,
                npwp: true,
              },
            },
          },
        },
      },
      orderBy: { periodStart: 'asc' },
    });

    // Aggregate per employee across all matching payroll runs
    const byEmployee = new Map<string, {
      employeeNo: string;
      employeeName: string;
      npwp: string | null;
      grossPay: number;
      taxableIncome: number;
      pph21: number;
      bpjsKesEmployee: number;
      bpjsKesEmployer: number;
      bpjsJhtEmployee: number;
      bpjsJhtEmployer: number;
      bpjsJpEmployee: number;
      bpjsJpEmployer: number;
      bpjsJkkEmployer: number;
      bpjsJkmEmployer: number;
      totalDeductions: number;
      netPay: number;
    }>();

    for (const run of payrollRuns) {
      for (const line of run.lines) {
        const emp = line.employee;
        const existing = byEmployee.get(emp.id) || {
          employeeNo: emp.employeeNo,
          employeeName: emp.name,
          npwp: emp.npwp,
          grossPay: 0,
          taxableIncome: 0,
          pph21: 0,
          bpjsKesEmployee: 0,
          bpjsKesEmployer: 0,
          bpjsJhtEmployee: 0,
          bpjsJhtEmployer: 0,
          bpjsJpEmployee: 0,
          bpjsJpEmployer: 0,
          bpjsJkkEmployer: 0,
          bpjsJkmEmployer: 0,
          totalDeductions: 0,
          netPay: 0,
        };

        const basicSalary = toNumber(line.basicSalary);
        const totalAllowances = toNumber(line.totalAllowances);
        const overtimePay = toNumber(line.overtimePay);
        const grossPay = basicSalary + totalAllowances + overtimePay;

        const pph21 = toNumber(line.pph21Amount);
        const bpjsKesEmp = toNumber(line.bpjsKesEmployee);
        const bpjsKesEr = toNumber(line.bpjsKesEmployer);
        const bpjsJhtEmp = toNumber(line.bpjsJhtEmployee);
        const bpjsJhtEr = toNumber(line.bpjsJhtEmployer);
        const bpjsJpEmp = toNumber(line.bpjsJpEmployee);
        const bpjsJpEr = toNumber(line.bpjsJpEmployer);
        const bpjsJkkEr = toNumber(line.bpjsJkkEmployer);
        const bpjsJkmEr = toNumber(line.bpjsJkmEmployer);

        const lineDeductions = toNumber(line.totalDeductions);
        const taxableIncome = grossPay - lineDeductions;

        existing.grossPay = asMoney(existing.grossPay + grossPay);
        existing.taxableIncome = asMoney(existing.taxableIncome + taxableIncome);
        existing.pph21 = asMoney(existing.pph21 + pph21);
        existing.bpjsKesEmployee = asMoney(existing.bpjsKesEmployee + bpjsKesEmp);
        existing.bpjsKesEmployer = asMoney(existing.bpjsKesEmployer + bpjsKesEr);
        existing.bpjsJhtEmployee = asMoney(existing.bpjsJhtEmployee + bpjsJhtEmp);
        existing.bpjsJhtEmployer = asMoney(existing.bpjsJhtEmployer + bpjsJhtEr);
        existing.bpjsJpEmployee = asMoney(existing.bpjsJpEmployee + bpjsJpEmp);
        existing.bpjsJpEmployer = asMoney(existing.bpjsJpEmployer + bpjsJpEr);
        existing.bpjsJkkEmployer = asMoney(existing.bpjsJkkEmployer + bpjsJkkEr);
        existing.bpjsJkmEmployer = asMoney(existing.bpjsJkmEmployer + bpjsJkmEr);

        const employeeTotalDeductions = pph21 + bpjsKesEmp + bpjsJhtEmp + bpjsJpEmp;
        existing.totalDeductions = asMoney(existing.totalDeductions + employeeTotalDeductions);
        existing.netPay = asMoney(existing.netPay + toNumber(line.netPay));

        byEmployee.set(emp.id, existing);
      }
    }

    const rows = Array.from(byEmployee.values()).sort((a, b) =>
      a.employeeNo.localeCompare(b.employeeNo),
    );

    const summary = rows.reduce(
      (acc, row) => ({
        employeeCount: acc.employeeCount + 1,
        totalGrossPay: asMoney(acc.totalGrossPay + row.grossPay),
        totalTaxableIncome: asMoney(acc.totalTaxableIncome + row.taxableIncome),
        totalPph21: asMoney(acc.totalPph21 + row.pph21),
        totalBpjsKesEmployee: asMoney(acc.totalBpjsKesEmployee + row.bpjsKesEmployee),
        totalBpjsKesEmployer: asMoney(acc.totalBpjsKesEmployer + row.bpjsKesEmployer),
        totalBpjsJhtEmployee: asMoney(acc.totalBpjsJhtEmployee + row.bpjsJhtEmployee),
        totalBpjsJhtEmployer: asMoney(acc.totalBpjsJhtEmployer + row.bpjsJhtEmployer),
        totalBpjsJpEmployee: asMoney(acc.totalBpjsJpEmployee + row.bpjsJpEmployee),
        totalBpjsJpEmployer: asMoney(acc.totalBpjsJpEmployer + row.bpjsJpEmployer),
        totalBpjsJkkEmployer: asMoney(acc.totalBpjsJkkEmployer + row.bpjsJkkEmployer),
        totalBpjsJkmEmployer: asMoney(acc.totalBpjsJkmEmployer + row.bpjsJkmEmployer),
        totalDeductions: asMoney(acc.totalDeductions + row.totalDeductions),
        totalNetPay: asMoney(acc.totalNetPay + row.netPay),
      }),
      {
        employeeCount: 0,
        totalGrossPay: 0,
        totalTaxableIncome: 0,
        totalPph21: 0,
        totalBpjsKesEmployee: 0,
        totalBpjsKesEmployer: 0,
        totalBpjsJhtEmployee: 0,
        totalBpjsJhtEmployer: 0,
        totalBpjsJpEmployee: 0,
        totalBpjsJpEmployer: 0,
        totalBpjsJkkEmployer: 0,
        totalBpjsJkmEmployer: 0,
        totalDeductions: 0,
        totalNetPay: 0,
      },
    );

    return ok({ type, dateFrom, dateTo, rows, summary });
  }

  return err('Unknown report type', 400);
});
