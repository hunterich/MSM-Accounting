import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api-utils';
import { postJournalEntry, type JournalLineInput } from '@/lib/journal-posting';
import { assertPeriodOpen } from '@/lib/period-guard';
import { selectCashAccounts } from './cash-accounts';
import { assertNoDirectControlPosting } from './control-account-guard';

export async function lockPayroll(tx: Prisma.TransactionClient, orgId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll:${orgId}`}, 0))`;
}

/** Shared by submission and approval, so stored/legacy runs cannot bypass setup checks. */
export async function validatePayrollPosting(tx: Prisma.TransactionClient, orgId: string, id: string) {
  await lockPayroll(tx, orgId);
  const run = await tx.payrollRun.findFirst({ where: { id, organizationId: orgId }, include: { lines: true } });
  if (!run) throw new ApiError('Payroll run not found', 404);
  if (run.journalEntryId) return { run, accounts: null };
  if (!['CALCULATED', 'REVIEWED', 'PENDING_APPROVAL'].includes(run.status) || !run.lines.length) throw new ApiError('Calculate and review payroll before posting.', 422);
  if (Array.isArray(run.reviewIssues) && run.reviewIssues.length) throw new ApiError('Payroll requires attendance/setup review. Correct the listed issues and recalculate before posting.', 422);
  await assertPeriodOpen(tx, orgId, run.periodEnd);
  const all = await tx.account.findMany({ where: { organizationId: orgId } });
  const active = all.filter(a => a.isActive && a.isPostable);
  const required = (code: string, type: string, label: string) => {
    const a = active.find(a => a.code === code && a.type === type);
    if (!a) throw new ApiError(`Payroll setup: configure an active, postable ${label} account (${code}, ${type}). No fallback account will be used.`, 422);
    return a;
  };
  const salary = required('5100', 'EXPENSE', 'Salary Expense');
  const tax = required('2300', 'LIABILITY', 'PPh 21 Payable');
  const bpjs = required('2310', 'LIABILITY', 'BPJS Payable');
  const cashChoices = selectCashAccounts(all).filter(a => a.isActive);
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { accountDefaults: true } });
  const configured = (org.accountDefaults as Record<string, string> | null)?.bankAsset;
  const cash = configured ? cashChoices.find(a => a.id === configured) : cashChoices.length === 1 ? cashChoices[0] : undefined;
  if (!cash) throw new ApiError('Payroll setup: select a valid default Bank / Cash Asset account in Company Setup. Inventory and other asset accounts cannot fund payroll.', 422);
  await assertNoDirectControlPosting(tx, orgId, [salary.id, tax.id, bpjs.id, cash.id]);
  const deductions: Array<{ accountId: string; amount: number; name: string }> = [];
  for (const line of run.lines) {
    const entries = line.deductionPostings;
    if (!Array.isArray(entries) && Number(line.totalDeductions)) throw new ApiError('Payroll setup: deduction account mappings are missing. Map each employee deduction and recalculate this payroll.', 422);
    let sum = 0;
    for (const raw of Array.isArray(entries) ? entries : []) {
      const d = raw as { accountId?: string; amount?: number; name?: string };
      const amount = Number(d.amount);
      const account = active.find(a => a.id === d.accountId && ['ASSET', 'LIABILITY'].includes(a.type));
      if (!account || cashChoices.some(a => a.id === account.id) || !Number.isFinite(amount) || amount < 0) throw new ApiError(`Payroll setup: deduction "${d.name || 'Unnamed'}" needs an active employee receivable or deduction payable account in this company; Cash/Bank and AR/AP controls are not allowed.`, 422);
      deductions.push({ accountId: account.id, amount, name: d.name || 'Employee deduction' }); sum += amount;
    }
    if (Math.abs(sum - Number(line.totalDeductions)) > 0.005) throw new ApiError('Payroll deduction snapshot does not match its total. Recalculate payroll.', 422);
  }
  await assertNoDirectControlPosting(tx, orgId, deductions.map(d => d.accountId));
  return { run, accounts: { salary, cash, tax, bpjs, deductions } };
}

export async function postPayrollRunToLedger(tx: Prisma.TransactionClient, orgId: string, id: string): Promise<{ journalEntryId: string }> {
  const { run, accounts } = await validatePayrollPosting(tx, orgId, id);
  if (run.journalEntryId) return { journalEntryId: run.journalEntryId };
  if (!accounts) throw new ApiError('Payroll accounts unavailable', 422);
  const employer = run.lines.reduce((s, l) => s + Number(l.totalBpjsEmployer), 0);
  const employee = run.lines.reduce((s, l) => s + Number(l.totalBpjsEmployee), 0);
  const memo = `Payroll ${run.month}/${run.year} - ${run.number}`;
  const lines: JournalLineInput[] = [];
  const signed = (accountId: string, description: string, debit: number) => {
    if (debit) lines.push({ accountId, description, debit: Math.max(debit, 0), credit: Math.max(-debit, 0) });
  };
  signed(accounts.salary.id, `Salary expense - ${memo}`, Number(run.totalGross) + employer);
  signed(accounts.cash.id, `Net salary payment - ${memo}`, -Number(run.totalNet));
  signed(accounts.tax.id, `PPh 21 payable - ${memo}`, -Number(run.totalTax));
  signed(accounts.bpjs.id, `BPJS payable - ${memo}`, -(employee + employer));
  for (const d of accounts.deductions) signed(d.accountId, `${d.name} - ${memo}`, -d.amount);
  const entry = await postJournalEntry(tx, { organizationId: orgId, date: run.periodEnd, memo, source: 'SYSTEM', lines });
  await tx.payrollRun.update({ where: { id }, data: { journalEntryId: entry.id } });
  return { journalEntryId: entry.id };
}
