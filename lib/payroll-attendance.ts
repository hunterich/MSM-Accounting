export type PayrollAttendanceRecord = {
  date: Date;
  status: string;
  sickCertified?: boolean;
};
export type PaidLeave = {
  startDate: Date;
  endDate: Date;
  status: string;
  leaveType: { category: string; isPaid?: boolean | null };
};
const day = (d: Date) => d.toISOString().slice(0, 10);

/** One decision per scheduled day; absence of evidence is never full attendance. */
export function summarizePayrollAttendance(
  start: Date,
  end: Date,
  records: PayrollAttendanceRecord[],
  leaves: PaidLeave[] = [],
  workWeekDays = 5,
  holidays: string[] = [],
) {
  const byDay = new Map(records.map((r) => [day(r.date), r]));
  let workingDays = 0,
    presentDays = 0,
    sickDays = 0,
    leaveDays = 0,
    absentDays = 0;
  const issues: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = day(d),
      weekday = d.getUTCDay();
    if (
      weekday === 0 ||
      (workWeekDays === 5 && weekday === 6) ||
      holidays.includes(date)
    )
      continue;
    workingDays++;
    const r = byDay.get(date);
    const approved = leaves.filter(
      (l) =>
        l.status === 'APPROVED' &&
        day(l.startDate) <= date &&
        day(l.endDate) >= date,
    );
    if (new Set(approved.map((l) => l.leaveType.category)).size > 1) {
      issues.push(date + ': conflicting approved leave categories');
      continue;
    }
    if (approved.length) {
      const category = approved[0].leaveType.category;
      if (category === 'SICK') sickDays++;
      else if (['ANNUAL', 'MATERNITY', 'PATERNITY'].includes(category))
        leaveDays++;
      else if (category === 'UNPAID') absentDays++;
      else if (category === 'OTHER') {
        const paid = new Set(approved.map((l) => l.leaveType.isPaid));
        if (
          paid.size !== 1 ||
          typeof approved[0].leaveType.isPaid !== 'boolean'
        )
          issues.push(
            date +
              ': approved OTHER leave needs a consistent paid/unpaid classification in Leave Types',
          );
        else if (approved[0].leaveType.isPaid) leaveDays++;
        else absentDays++;
      } else
        issues.push(
          date + ': approved leave category needs payroll classification',
        );
      continue;
    }
    if (!r) {
      issues.push(`${date}: missing attendance`);
      continue;
    }
    if (r.status === 'PRESENT' || r.status === 'LATE') presentDays++;
    else if (r.status === 'HALF_DAY') {
      presentDays += 0.5;
      absentDays += 0.5;
    } else if (r.status === 'SICK' && r.sickCertified) sickDays++;
    else if (r.status === 'ABSENT') absentDays++;
    else
      issues.push(
        `${date}: ${r.status === 'SICK' ? 'sick day requires doctor certification' : 'leave requires approval/classification'}`,
      );
  }
  return {
    workingDays,
    presentDays,
    absentDays,
    sickDays,
    leaveDays,
    paidDays: presentDays + sickDays + leaveDays,
    issues,
  };
}
