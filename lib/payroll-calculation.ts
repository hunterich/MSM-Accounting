import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ApiError } from './api-utils';
import { lockPayroll } from './payroll-posting';
import {
  payrollRulesSchema,
  employmentWindow,
  terCategory,
  annualPPh21,
  type PTKPStatus,
  type OvertimeDay,
} from './payroll-rules';
import { calculatePayrollLine } from './payroll-calc';
import { summarizePayrollAttendance } from './payroll-attendance';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;
const adjustmentsSchema = z.array(
  z.object({
    employeeId: z.string(),
    amount: z.number(),
    description: z.string(),
    recoveryAccountId: z.string().optional(),
  }),
);

/** One organisation payroll lock serialises YTD/monthly tax and BPJS snapshots. */
export async function calculatePayroll(
  tx: Prisma.TransactionClient,
  orgId: string,
  id: string,
) {
  await lockPayroll(tx, orgId);
  const run = await tx.payrollRun.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!run) throw new ApiError('Payroll run not found', 404);
  if (
    !['DRAFT', 'CALCULATED', 'REVIEWED'].includes(run.status) ||
    run.journalEntryId
  )
    throw new ApiError(
      'Only draft/calculated/reviewed payroll can be recalculated; pending approval and posted runs are frozen.',
      409,
    );
  const policy = await tx.payrollPolicy.findFirst({
    where: {
      organizationId: orgId,
      effectiveFrom: { lte: run.periodStart },
      validUntil: { gte: run.periodEnd },
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!policy)
    throw new ApiError(
      'Payroll setup: add effective-dated BPJS rates/ceilings covering this period. Update the JP ceiling policy each March.',
      422,
    );
  const rules = payrollRulesSchema.parse(policy.rules);
  const adjustments = adjustmentsSchema.parse(
    (run.runInputs as { adjustments?: unknown } | null)?.adjustments ?? [],
  );
  const isRegular = run.runType === 'REGULAR',
    isFinal = run.runType === 'FINAL';
  if (
    await tx.employee.findFirst({
      where: {
        organizationId: orgId,
        status: 'INACTIVE',
        employmentEndDate: null,
        joinDate: { lte: run.periodEnd },
      },
    })
  )
    throw new ApiError(
      'Payroll setup: inactive employees need a last working day before dated payroll can be calculated. Preserve final/historical eligibility.',
      422,
    );
  const employees = await tx.employee.findMany({
    where: {
      organizationId: orgId,
      joinDate: { lte: run.periodEnd },
      ...(isRegular || isFinal
        ? {
            OR: [
              { employmentEndDate: null, status: 'ACTIVE' },
              { employmentEndDate: { gte: run.periodStart } },
            ],
          }
        : { id: { in: adjustments.map((a) => a.employeeId) } }),
    },
    include: { compensationItems: true },
  });
  if (!employees.length)
    throw new ApiError('No employees eligible for this payroll period.', 422);
  if (adjustments.some((a) => !employees.some((e) => e.id === a.employeeId)))
    throw new ApiError(
      'An adjustment employee is outside this company or employment period.',
      422,
    );
  const history = await tx.payrollRun.findMany({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      year: run.year,
      id: { not: id },
    },
    include: { lines: true },
    orderBy: { id: 'asc' },
  });
  // Posted future months would make historical TER/final reconciliation ambiguous.
  if (history.some((h) => h.month > run.month))
    throw new ApiError(
      'Later payroll is already posted. Resolve the later runs before recalculating an earlier tax period.',
      409,
    );
  const attendance = await tx.attendanceRecord.findMany({
    where: {
      organizationId: orgId,
      date: { gte: run.periodStart, lte: run.periodEnd },
    },
  });
  const leaves = await tx.leaveRequest.findMany({
    where: {
      organizationId: orgId,
      status: 'APPROVED',
      startDate: { lte: run.periodEnd },
      endDate: { gte: run.periodStart },
    },
    include: { leaveType: true },
  });
  const issues: string[] = [];
  const lines: Prisma.PayrollLineCreateManyInput[] = [];
  for (const emp of employees) {
    const window = employmentWindow(emp, run.periodStart, run.periodEnd);
    const ended = emp.employmentEndDate;
    if (
      isFinal &&
      (!ended || ended < run.periodStart || ended > run.periodEnd)
    ) {
      if (adjustments.some((a) => a.employeeId === emp.id))
        throw new ApiError(
          `${emp.employeeNo}: final run requires an employment end date in this month.`,
          422,
        );
      continue;
    }
    if (!window)
      throw new ApiError(
        `${emp.employeeNo}: employee is not employed during this period. Select the final employment month for corrections.`,
        422,
      );
    const prior = history.flatMap((h) =>
      h.lines
        .filter((l) => l.employeeId === emp.id)
        .map((l) => ({ run: h, line: l })),
    );
    const monthPrior = prior.filter((p) => p.run.month === run.month);
    const alreadySalary = monthPrior.some(
      (p) =>
        (p.line.calculationSnapshot as { salaryIncluded?: boolean } | null)
          ?.salaryIncluded || p.run.runType === 'REGULAR',
    );
    // A posted FINAL can settle one leaver before the rest of the company is paid.
    // Never create a second salary/BPJS line for that employee in REGULAR.
    if (isRegular && alreadySalary) continue;
    if (!emp.ptkpStatus || emp.ptkpYear !== run.year)
      throw new ApiError(
        `${emp.employeeNo}: select PTKP status for ${run.year} before calculating payroll.`,
        422,
      );
    const status = emp.ptkpStatus as PTKPStatus,
      category = terCategory(status);
    for (const p of prior) {
      const snapshot = p.line.calculationSnapshot as {
        ptkpStatus?: string;
      } | null;
      if (snapshot?.ptkpStatus && snapshot.ptkpStatus !== status)
        throw new ApiError(
          emp.employeeNo +
            ': PTKP differs from the status used earlier this tax year. Review the year-start status.',
          422,
        );
    }
    const includeSalary = (isRegular || isFinal) && !alreadySalary;
    const ownAttendance = attendance.filter((a) => a.employeeId === emp.id);
    const summary = summarizePayrollAttendance(
      window.from,
      window.to,
      ownAttendance,
      leaves.filter((l) => l.employeeId === emp.id),
      emp.workWeekDays,
      rules.holidays,
    );
    const denominator = summarizePayrollAttendance(
      run.periodStart,
      run.periodEnd,
      [],
      [],
      emp.workWeekDays,
      rules.holidays,
    ).workingDays;
    if (includeSalary)
      issues.push(...summary.issues.map((i) => `${emp.employeeNo}: ${i}`));
    if (emp.type === 'CONTRACT' && !emp.contractEndDate)
      issues.push(
        `${emp.employeeNo}: enter the contract end/renewal date before payroll review.`,
      );
    if (
      emp.type === 'CONTRACT' &&
      emp.contractEndDate &&
      emp.contractEndDate < run.periodEnd &&
      !ended
    )
      issues.push(
        `${emp.employeeNo}: contract expired; confirm renewal or record the last working day.`,
      );
    const comp = emp.compensationItems;
    if (
      includeSalary &&
      comp.some(
        (c) =>
          c.type === 'ALLOWANCE' && Number(c.amount) > 0 && c.isFixed === null,
      )
    )
      throw new ApiError(
        `${emp.employeeNo}: classify each allowance as fixed or variable.`,
        422,
      );
    const fixed = includeSalary
      ? comp
          .filter((c) => c.type === 'ALLOWANCE' && c.isFixed)
          .reduce((s, c) => s + Number(c.amount), 0)
      : 0;
    const allowances = includeSalary
      ? comp
          .filter((c) => c.type === 'ALLOWANCE')
          .reduce((s, c) => s + Number(c.amount), 0)
      : 0;
    const deductions = includeSalary
      ? comp.filter((c) => c.type === 'DEDUCTION' && Number(c.amount) > 0)
      : [];
    if (deductions.some((c) => !c.postingAccountId))
      throw new ApiError(
        `${emp.employeeNo}: map each employee deduction to its receivable/payable account.`,
        422,
      );
    const extra = adjustments
      .filter((a) => a.employeeId === emp.id)
      .reduce((s, a) => s + a.amount, 0);
    const otDays: OvertimeDay[] = includeSalary
      ? ownAttendance
          .filter(
            (a) =>
              Number(a.overtimeHours) > 0 &&
              a.date >= window.from &&
              a.date <= window.to,
          )
          .map((a) => {
            const weekday = a.date.getUTCDay(),
              holiday = rules.holidays.includes(iso(a.date));
            return {
              date: iso(a.date),
              hours: Number(a.overtimeHours),
              kind: holiday
                ? emp.workWeekDays === 6 && weekday === rules.shortWorkday
                  ? 'SHORT_HOLIDAY'
                  : 'HOLIDAY'
                : weekday === 0 || (emp.workWeekDays === 5 && weekday === 6)
                  ? 'REST'
                  : 'WORKDAY',
            };
          })
      : [];
    const applyBpjs =
      includeSalary &&
      !monthPrior.some(
        (p) =>
          !!(p.line.calculationSnapshot as { bpjsIncluded?: boolean } | null)
            ?.bpjsIncluded,
      );
    const calc = calculatePayrollLine(
      {
        basicSalary: includeSalary ? Number(emp.basicSalary) : 0,
        fixedAllowances: fixed,
        allowances,
        extraEarnings: extra,
        deductions: deductions.reduce((s, c) => s + Number(c.amount), 0),
      },
      { ...summary, workingDays: includeSalary ? denominator : 0 },
      otDays,
      category,
      rules.bpjs,
      applyBpjs,
      emp.workWeekDays,
    );
    const isLast =
      run.month === 12 ||
      !!(
        ended &&
        ended.getUTCFullYear() === run.year &&
        ended.getUTCMonth() + 1 === run.month
      );
    const taxGross = (l: (typeof prior)[number]['line']) => {
      const snap = l.calculationSnapshot as { taxGross?: number } | null;
      return (
        snap?.taxGross ??
        Number(l.grossPay) +
          Number(l.bpjsKesEmployer) +
          Number(l.bpjsJkkEmployer) +
          Number(l.bpjsJkmEmployer)
      );
    };
    if (
      prior.reduce((s, p) => s + taxGross(p.line), 0) + calc.taxGross < 0 ||
      monthPrior.reduce((s, p) => s + taxGross(p.line), 0) + calc.taxGross < 0
    )
      throw new ApiError(
        emp.employeeNo +
          ': correction exceeds the taxable earnings recorded for this period.',
        422,
      );
    let annual: ReturnType<typeof annualPPh21> | null = null;
    if (isLast) {
      const firstMonth =
        emp.joinDate.getUTCFullYear() === run.year
          ? emp.joinDate.getUTCMonth()
          : 0;
      const missingMonths = Array.from(
        { length: Math.max(0, run.month - firstMonth - 1) },
        (_, i) => firstMonth + i + 1,
      ).filter(
        (month) =>
          !prior.some(
            (p) =>
              p.run.month === month &&
              ((
                p.line.calculationSnapshot as {
                  salaryIncluded?: boolean;
                } | null
              )?.salaryIncluded ||
                ['REGULAR', 'FINAL'].includes(p.run.runType)),
          ),
      );
      if (missingMonths.length)
        throw new ApiError(
          emp.employeeNo +
            ': final-period tax requires complete posted YTD payroll; missing months ' +
            missingMonths.join(', ') +
            '. Enter verified payroll history before reconciliation.',
          422,
        );
      annual = annualPPh21(
        prior.reduce((s, p) => s + taxGross(p.line), 0) + calc.taxGross,
        prior.reduce(
          (s, p) =>
            s + Number(p.line.bpjsJhtEmployee) + Number(p.line.bpjsJpEmployee),
          0,
        ) +
          calc.bpjs.employee.jht +
          calc.bpjs.employee.jp,
        status,
        run.month - firstMonth,
      );
      calc.pph21 =
        annual.tax - prior.reduce((s, p) => s + Number(p.line.pph21), 0);
    } else {
      // Off-cycle THR/corrections use the combined monthly TER, not a fresh bracket per run.
      const combined =
        monthPrior.reduce((s, p) => s + taxGross(p.line), 0) + calc.taxGross;
      const { calculatePPh21TER } = await import('./payroll-calc');
      calc.pph21 =
        calculatePPh21TER(combined, category) -
        monthPrior.reduce((s, p) => s + Number(p.line.pph21), 0);
    }
    calc.netPay = round(
      calc.grossPay -
        calc.totalDeductions -
        calc.totalBpjsEmployee -
        calc.pph21,
    );
    const recoveryIds = [
      ...new Set(
        adjustments
          .filter((a) => a.employeeId === emp.id && a.recoveryAccountId)
          .map((a) => a.recoveryAccountId!),
      ),
    ];
    if (recoveryIds.length > 1)
      throw new ApiError(
        emp.employeeNo +
          ': select one recovery receivable for this employee correction.',
        422,
      );
    if (calc.netPay < 0 && recoveryIds.length !== 1)
      issues.push(
        emp.employeeNo +
          ': negative net pay requires an explicit employee-recovery receivable; no negative bank payment will be posted.',
      );
    lines.push({
      payrollRunId: id,
      employeeId: emp.id,
      basicSalary: calc.basicSalary,
      totalAllowances: calc.totalAllowances,
      totalDeductions: calc.totalDeductions,
      overtimePay: calc.overtimePay,
      grossPay: calc.grossPay,
      pph21: calc.pph21,
      netPay: calc.netPay,
      totalBpjsEmployee: calc.totalBpjsEmployee,
      totalBpjsEmployer: calc.totalBpjsEmployer,
      bpjsKesEmployee: calc.bpjs.employee.kesehatan,
      bpjsKesEmployer: calc.bpjs.employer.kesehatan,
      bpjsJhtEmployee: calc.bpjs.employee.jht,
      bpjsJhtEmployer: calc.bpjs.employer.jht,
      bpjsJpEmployee: calc.bpjs.employee.jp,
      bpjsJpEmployer: calc.bpjs.employer.jp,
      bpjsJkkEmployer: calc.bpjs.employer.jkk,
      bpjsJkmEmployer: calc.bpjs.employer.jkm,
      workingDays: includeSalary ? denominator : 0,
      presentDays: includeSalary ? calc.presentDays : 0,
      paidDays: includeSalary ? calc.paidDays : 0,
      absentDays: includeSalary ? calc.absentDays : 0,
      overtimeHours: calc.overtimeHours,
      deductionPostings: deductions.map((c) => ({
        accountId: c.postingAccountId,
        name: c.name,
        amount: Number(c.amount),
      })),
      calculationSnapshot: {
        version: 1,
        netRecoveryAccountId: recoveryIds[0] ?? null,
        policyId: policy.id,
        rules: rules as unknown as Prisma.InputJsonValue,
        ptkpStatus: status,
        ptkpYear: run.year,
        category,
        salaryIncluded: includeSalary,
        bpjsIncluded: applyBpjs,
        taxGross: calc.taxGross,
        annual: annual as unknown as Prisma.InputJsonValue,
        employmentStart: iso(emp.joinDate),
        employmentEnd: ended ? iso(ended) : null,
        contractEnd: emp.contractEndDate ? iso(emp.contractEndDate) : null,
        attendance: includeSalary
          ? {
              eligibleWorkingDays: summary.workingDays,
              workingDays: denominator,
              presentDays: summary.presentDays,
              sickDays: summary.sickDays,
              leaveDays: summary.leaveDays,
              absentDays: summary.absentDays,
              paidDays: summary.paidDays,
              approvedLeaves: leaves
                .filter(
                  (l) =>
                    l.employeeId === emp.id &&
                    l.startDate <= window.to &&
                    l.endDate >= window.from,
                )
                .map((l) => ({
                  id: l.id,
                  category: l.leaveType.category,
                  isPaid: l.leaveType.isPaid,
                  startDate: iso(l.startDate),
                  endDate: iso(l.endDate),
                })),
            }
          : null,
        overtimeDays: otDays as unknown as Prisma.InputJsonValue,
        adjustments: adjustments.filter((a) => a.employeeId === emp.id),
      },
    });
  }
  if (!lines.length)
    throw new ApiError('No employees eligible for this run type.', 422);
  await tx.payrollLine.deleteMany({ where: { payrollRunId: id } });
  await tx.payrollLine.createMany({ data: lines });
  const total = (key: 'grossPay' | 'pph21' | 'netPay') =>
    round(lines.reduce((s, l) => s + Number(l[key]), 0));
  await tx.payrollRun.update({
    where: { id },
    data: {
      status: 'CALCULATED',
      reviewIssues: issues,
      calculationBasis: {
        version: 1,
        priorPostedIds: history.map((h) => h.id),
      },
      totalGross: total('grossPay'),
      totalTax: total('pph21'),
      totalNet: total('netPay'),
      totalDeductions: round(
        lines.reduce(
          (s, l) => s + Number(l.totalDeductions) + Number(l.totalBpjsEmployee),
          0,
        ),
      ),
      totalBpjs: round(
        lines.reduce(
          (s, l) =>
            s + Number(l.totalBpjsEmployee) + Number(l.totalBpjsEmployer),
          0,
        ),
      ),
    },
  });
  return tx.payrollRun.findUniqueOrThrow({
    where: { id },
    include: {
      lines: {
        include: {
          employee: { select: { id: true, name: true, employeeNo: true } },
        },
      },
    },
  });
}
