export type PayrollAttendanceRecord = { date: Date; status: string; sickCertified?: boolean };
export type PaidLeave = { startDate: Date; endDate: Date; status: string; leaveType: { category: string } };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** One decision per scheduled day; absence of evidence is never full attendance. */
export function summarizePayrollAttendance(start: Date, end: Date, records: PayrollAttendanceRecord[], leaves: PaidLeave[] = [], workWeekDays = 5, holidays: string[] = []) {
  const byDay = new Map(records.map(r => [day(r.date), r]));
  let workingDays = 0, presentDays = 0, sickDays = 0, leaveDays = 0, absentDays = 0;
  const issues: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = day(d), weekday = d.getUTCDay();
    if (weekday === 0 || (workWeekDays === 5 && weekday === 6) || holidays.includes(date)) continue;
    workingDays++;
    const r = byDay.get(date);
    const approved = leaves.some(l => l.status === 'APPROVED' && l.leaveType.category === 'ANNUAL' && day(l.startDate) <= date && day(l.endDate) >= date);
    if (approved) { leaveDays++; continue; }
    if (!r) { issues.push(`${date}: missing attendance`); continue; }
    if (r.status === 'PRESENT' || r.status === 'LATE') presentDays++;
    else if (r.status === 'HALF_DAY') { presentDays += 0.5; absentDays += 0.5; }
    else if (r.status === 'SICK' && r.sickCertified) sickDays++;
    else if (r.status === 'ABSENT') absentDays++;
    else issues.push(`${date}: ${r.status === 'SICK' ? 'sick day requires doctor certification' : 'leave requires approval/classification'}`);
  }
  return { workingDays, presentDays, absentDays, sickDays, leaveDays, paidDays: presentDays + sickDays + leaveDays, issues };
}
