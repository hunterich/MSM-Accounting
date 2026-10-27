import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { calculatePayrollLine, type AttendanceSummary, type EmployeePayData } from '@/lib/payroll-calc';

import { summarizePayrollAttendance } from '@/lib/payroll-attendance';
import { lockPayroll } from '@/lib/payroll-posting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'HR_PAYROLL', action: 'create' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;

  try {
    const payrollRun = await prisma.payrollRun.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!payrollRun) return err('Payroll run not found', 404);
    if (!['DRAFT', 'CALCULATED', 'REVIEWED'].includes(payrollRun.status)) return err('Cannot recalculate posted payroll run', 400);

    // Fetch all active employees with compensation items
    const employees = await prisma.employee.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      include: { compensationItems: true },
    });

    if (employees.length === 0) {
      return err('No active employees found', 400);
    }

    // Fetch attendance for the period
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        organizationId: orgId,
        date: {
          gte: payrollRun.periodStart,
          lte: payrollRun.periodEnd,
        },
      },
    });

    // Build attendance map by employee
    const attendanceMap = new Map<string, typeof attendanceRecords>();
    for (const record of attendanceRecords) {
      const existing = attendanceMap.get(record.employeeId) || [];
      existing.push(record);
      attendanceMap.set(record.employeeId, existing);
    }

    const leaves = await prisma.leaveRequest.findMany({ where: { organizationId: orgId, status: 'APPROVED', startDate: { lte: payrollRun.periodEnd }, endDate: { gte: payrollRun.periodStart } }, include: { leaveType: true } });
    const reviewIssues: string[] = [];
    // Delete existing lines and create new ones
    await prisma.$transaction(async (tx) => {
      await lockPayroll(tx, orgId);
      const current = await tx.payrollRun.findFirstOrThrow({ where: { id, organizationId: orgId } });
      if (current.updatedAt.getTime() !== payrollRun.updatedAt.getTime() || !['DRAFT', 'CALCULATED', 'REVIEWED'].includes(current.status)) throw new ApiError('Payroll changed while calculating. Reload and retry.', 409);
      await tx.payrollLine.deleteMany({ where: { payrollRunId: id } });

      let totalGross = 0;
      let totalDeductions = 0;
      let totalTax = 0;
      let totalBpjs = 0;
      let totalNet = 0;

      for (const emp of employees) {
        const empAttendance = attendanceMap.get(emp.id) || [];
        const totalOvertimeHours = empAttendance.reduce(
          (sum, a) => sum + Number(a.overtimeHours || 0),
          0,
        );

        const allowances = emp.compensationItems
          .filter((c) => c.type === 'ALLOWANCE')
          .reduce((sum, c) => sum + Number(c.amount), 0);
        const deductions = emp.compensationItems
          .filter((c) => c.type === 'DEDUCTION')
          .reduce((sum, c) => sum + Number(c.amount), 0);

        const employeeData: EmployeePayData = {
          basicSalary: Number(emp.basicSalary),
          allowances,
          deductions,
        };

        const attendance = summarizePayrollAttendance(payrollRun.periodStart, payrollRun.periodEnd, empAttendance, leaves.filter(l => l.employeeId === emp.id));
        reviewIssues.push(...attendance.issues.map(issue => emp.employeeNo + ': ' + issue));
        const calc = calculatePayrollLine(employeeData, attendance, totalOvertimeHours);

        await tx.payrollLine.create({
          data: {
            payrollRunId: id,
            employeeId: emp.id,
            basicSalary: calc.basicSalary,
            totalAllowances: calc.totalAllowances,
            totalDeductions: calc.totalDeductions,
            overtimePay: calc.overtimePay,
            grossPay: calc.grossPay,
            bpjsKesEmployee: calc.bpjs.employee.kesehatan,
            bpjsKesEmployer: calc.bpjs.employer.kesehatan,
            bpjsJhtEmployee: calc.bpjs.employee.jht,
            bpjsJhtEmployer: calc.bpjs.employer.jht,
            bpjsJpEmployee: calc.bpjs.employee.jp,
            bpjsJpEmployer: calc.bpjs.employer.jp,
            bpjsJkkEmployer: calc.bpjs.employer.jkk,
            bpjsJkmEmployer: calc.bpjs.employer.jkm,
            pph21: calc.pph21,
            totalBpjsEmployee: calc.totalBpjsEmployee,
            totalBpjsEmployer: calc.totalBpjsEmployer,
            netPay: calc.netPay,
            workingDays: calc.workingDays,
            presentDays: calc.presentDays,
            paidDays: calc.paidDays,
            deductionPostings: emp.compensationItems.filter(c => c.type === 'DEDUCTION' && Number(c.amount) > 0).map(c => ({ name: c.name, accountId: c.postingAccountId, amount: Number(c.amount) })),
            absentDays: calc.absentDays,
            overtimeHours: calc.overtimeHours,
          },
        });

        totalGross += calc.grossPay;
        totalDeductions += calc.totalDeductions + calc.totalBpjsEmployee;
        totalTax += calc.pph21;
        totalBpjs += calc.totalBpjsEmployee + calc.totalBpjsEmployer;
        totalNet += calc.netPay;
      }

      // Update payroll run totals
      await tx.payrollRun.update({
        where: { id },
        data: {
          status: 'CALCULATED',
          reviewIssues,
          totalGross,
          totalDeductions,
          totalTax,
          totalBpjs,
          totalNet,
        },
      });
    });

    // Fetch updated payroll run with lines
    const updated = await prisma.payrollRun.findFirst({
      where: { id },
      include: {
        lines: {
          include: {
            employee: {
              select: { id: true, name: true, employeeNo: true },
            },
          },
          orderBy: { employee: { name: 'asc' } },
        },
      },
    });

    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'PayrollRun',
      entityId: id,
      action: 'UPDATE',
      payload: { action: 'CALCULATE', employees: employees.length },
    });

    return ok(updated);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to calculate payroll';
    return err(message, 500);
  }
});
