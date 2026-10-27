import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn() }));
vi.mock('../control-account-guard', () => ({ assertNoDirectControlPosting: vi.fn() }));
import { postPayrollRunToLedger } from '../payroll-posting';
import { postJournalEntry } from '../journal-posting';
import { calculatePayrollLine } from '../payroll-calc';
import { summarizePayrollAttendance } from '../payroll-attendance';
const d = (s: string) => new Date(s + 'T00:00:00Z');
const account = (id: string, code: string, type: string, name = id) => ({ id, code, type, name, reportGroup: name, parentId: null, isActive: true, isPostable: true });
function fixture(missing?: string) {
  const accounts = [account('salary','5100','EXPENSE'), account('tax','2300','LIABILITY'), account('bpjs','2310','LIABILITY'), account('cash','1100','ASSET','Cash'), account('advance','1400','ASSET','Employee advances'), account('inventory','1200','ASSET','Inventory'), account('ap','2100','LIABILITY','Accounts Payable')].filter(a => a.code !== missing);
  const run = { id: 'run', number: 'PAY-1', month: 10, year: 2026, status: 'REVIEWED', periodEnd: d('2026-10-31'), journalEntryId: null, reviewIssues: [], totalGross: 1000, totalNet: 800, totalTax: 50, lines: [{ totalBpjsEmployee: 50, totalBpjsEmployer: 100, totalDeductions: 100, deductionPostings: [{ accountId: 'advance', name: 'Advance repayment', amount: 100 }] }] };
  const tx = { $executeRaw: vi.fn(), payrollRun: { findFirst: vi.fn(async () => run), update: vi.fn() }, account: { findMany: vi.fn(async () => accounts) }, organization: { findUniqueOrThrow: vi.fn(async () => ({ accountDefaults: { bankAsset: 'cash' } })) } };
  return { tx: tx as unknown as Prisma.TransactionClient, run, accounts };
}
beforeEach(() => vi.clearAllMocks());
describe('payroll posting immediate fixes', () => {
  it('cash decreases only by net pay; employee deductions credit their saved receivable', async () => {
    const f = fixture(); await postPayrollRunToLedger(f.tx, 'org', 'run');
    const lines = vi.mocked(postJournalEntry).mock.calls[0][1].lines;
    expect(lines.filter(l => l.accountId === 'cash')).toEqual([expect.objectContaining({ debit: 0, credit: 800 })]);
    expect(lines.find(l => l.accountId === 'advance')).toMatchObject({ debit: 0, credit: 100 });
    expect(lines.find(l => l.accountId === 'tax')).toMatchObject({ credit: 50 });
    expect(lines.find(l => l.accountId === 'bpjs')).toMatchObject({ credit: 150 });
    expect(lines.reduce((s,l) => s + Number(l.debit) - Number(l.credit), 0)).toBe(0);
  });
  for (const code of ['5100', '2300', '2310']) it(`missing ${code} refuses before posting, despite unrelated assets/liabilities`, async () => {
    const f = fixture(code); await expect(postPayrollRunToLedger(f.tx, 'org', 'run')).rejects.toThrow(code);
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
  it('refuses a missing deduction mapping instead of crediting cash or tax', async () => {
    const f = fixture(); f.run.lines[0].deductionPostings[0].accountId = 'missing';
    await expect(postPayrollRunToLedger(f.tx, 'org', 'run')).rejects.toThrow('deduction');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
  it('unresolved attendance refuses at final posting', async () => {
    const f = fixture(); (f.run.reviewIssues as string[]).push('missing attendance');
    await expect(postPayrollRunToLedger(f.tx, 'org', 'run')).rejects.toThrow('review');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
});
describe('monthly TER gross basis', () => {
  it('adds employer health/JKK/JKM without subtracting employee JHT/JP', () => {
    const p = calculatePayrollLine({ basicSalary: 10_000_000, allowances: 0, deductions: 0 }, { workingDays: 22, presentDays: 22, sickDays: 0, leaveDays: 0, absentDays: 0 }, 0, 'A');
    expect(p.grossPay).toBe(10_000_000);
    expect(p.pph21).toBe(261_350); // 2.5% of 10,454,000
    expect(p.netPay).toBe(9_338_650);
  });
});
describe('paid attendance and missing-day review', () => {
  it('pays approved annual leave and certified sick leave; HALF_DAY is 0.5', () => {
    const a = summarizePayrollAttendance(d('2026-10-05'),d('2026-10-09'),[
      { date:d('2026-10-05'),status:'PRESENT' }, { date:d('2026-10-07'),status:'SICK',sickCertified:true }, { date:d('2026-10-08'),status:'HALF_DAY' },
    ],[{ startDate:d('2026-10-06'),endDate:d('2026-10-06'),status:'APPROVED',leaveType:{ category:'ANNUAL' } }]);
    expect(a).toMatchObject({ workingDays:5,presentDays:1.5,sickDays:1,leaveDays:1,paidDays:3.5,absentDays:0.5 });
    expect(a.issues).toEqual(['2026-10-09: missing attendance']);
  });
  it('never assumes full attendance for an empty record set', () => {
    const a=summarizePayrollAttendance(d('2026-10-05'),d('2026-10-09'),[]);
    expect(a.paidDays).toBe(0); expect(a.issues).toHaveLength(5);
  });
  it('requires certification or approval rather than trusting raw SICK/LEAVE labels', () => {
    const a=summarizePayrollAttendance(d('2026-10-05'),d('2026-10-06'),[{date:d('2026-10-05'),status:'SICK'}, {date:d('2026-10-06'),status:'LEAVE'}]);
    expect(a.paidDays).toBe(0); expect(a.issues).toHaveLength(2);
  });
});
