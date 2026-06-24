import { describe, expect, it } from 'vitest';
import {
  buildBalanceSheetReport,
  buildBalanceSheetMultiPeriodReport,
  buildCashFlowStatement,
  buildProfitLossReport,
  buildTrialBalanceReport,
} from '../gl-reporting';
import type {
  GlAccount,
  JournalLineRecord,
  TrialBalanceReport,
  ProfitLossReport,
  BalanceSheetReport,
  BalanceSheetMultiPeriodReport,
  CashFlowStatementReport,
} from '../gl-reporting';

const accounts: GlAccount[] = [
  { id: 'cash', code: '1-1000', name: 'Cash', type: 'ASSET', normalSide: 'DEBIT', isPostable: true },
  { id: 'ar', code: '1-1200', name: 'Accounts Receivable', type: 'ASSET', normalSide: 'DEBIT', isPostable: true },
  { id: 'ap', code: '2-1000', name: 'Accounts Payable', type: 'LIABILITY', normalSide: 'CREDIT', isPostable: true },
  { id: 'equity', code: '3-1000', name: 'Retained Earnings', type: 'EQUITY', normalSide: 'CREDIT', isPostable: true },
  { id: 'revenue', code: '4-1000', name: 'Sales Revenue', type: 'REVENUE', normalSide: 'CREDIT', isPostable: true },
  { id: 'expense', code: '5-1000', name: 'Operating Expense', type: 'EXPENSE', normalSide: 'DEBIT', isPostable: true },
];

const postedLines: JournalLineRecord[] = [
  { accountId: 'cash', debit: 1000, credit: 0 },
  { accountId: 'equity', debit: 0, credit: 1000 },
  { accountId: 'ar', debit: 800, credit: 0 },
  { accountId: 'revenue', debit: 0, credit: 800 },
  { accountId: 'expense', debit: 300, credit: 0 },
  { accountId: 'cash', debit: 0, credit: 300 },
  { accountId: 'cash', debit: 500, credit: 0 },
  { accountId: 'ap', debit: 0, credit: 500 },
];

describe('buildTrialBalanceReport', () => {
  it('returns balanced debit and credit totals', () => {
    const report: TrialBalanceReport = buildTrialBalanceReport(accounts, postedLines);

    expect(report.summary.totalDebit).toBe(2600);
    expect(report.summary.totalCredit).toBe(2600);
    expect(report.summary.endingDebit).toBe(2300);
    expect(report.summary.endingCredit).toBe(2300);
  });
});

describe('buildProfitLossReport', () => {
  it('summarizes revenue, expense, and net income', () => {
    const report: ProfitLossReport = buildProfitLossReport(accounts, postedLines);

    expect(report.summary.totalRevenue).toBe(800);
    expect(report.summary.totalExpense).toBe(300);
    expect(report.summary.netIncome).toBe(500);
    expect(report.sections[0].rows).toHaveLength(1);
    expect(report.sections[1].rows).toHaveLength(1);
  });
});

describe('buildBalanceSheetReport', () => {
  it('adds current earnings into equity so the statement balances', () => {
    const report: BalanceSheetReport = buildBalanceSheetReport(accounts, postedLines);

    expect(report.summary.totalAssets).toBe(2000);
    expect(report.summary.totalLiabilities).toBe(500);
    expect(report.summary.totalEquity).toBe(1500);
    expect(report.summary.currentEarnings).toBe(500);
    expect(report.summary.totalLiabilitiesAndEquity).toBe(2000);

    const equitySection = report.sections.find((section) => section.id === 'EQUITY');
    expect(equitySection!.rows.some((row) => row.accountName === 'Current Earnings')).toBe(true);
  });
});

describe('buildBalanceSheetMultiPeriodReport', () => {
  it('compares two balance sheet snapshots and computes variances', () => {
    const current: BalanceSheetReport = buildBalanceSheetReport(accounts, postedLines);
    const compare: BalanceSheetReport = buildBalanceSheetReport(accounts, [
      { accountId: 'cash', debit: 900, credit: 0 },
      { accountId: 'equity', debit: 0, credit: 900 },
    ]);

    const report: BalanceSheetMultiPeriodReport = buildBalanceSheetMultiPeriodReport(current, compare);

    expect(report.summary.current.totalAssets).toBe(2000);
    expect(report.summary.compare.totalAssets).toBe(900);
    expect(report.summary.variance.totalAssets).toBe(1100);

    const assetSection = report.sections.find((section) => section.id === 'ASSET');
    const cashRow = assetSection!.rows.find((row) => row.accountId === 'cash');
    expect(cashRow!.currentAmount).toBe(1200);
    expect(cashRow!.compareAmount).toBe(900);
    expect(cashRow!.variance).toBe(300);
  });
});

describe('buildCashFlowStatement', () => {
  // Cash account needs a reportGroup containing "cash"/"bank" so isCashAccount() detects it.
  const cfAccounts: GlAccount[] = [
    { id: 'cash', code: '1-1000', name: 'Cash', type: 'ASSET', normalSide: 'DEBIT', isPostable: true, reportGroup: 'Cash & Bank' },
    { id: 'ar', code: '1-1200', name: 'Accounts Receivable', type: 'ASSET', normalSide: 'DEBIT', isPostable: true, reportGroup: 'Current Assets' },
    { id: 'fixed', code: '1-2000', name: 'Equipment', type: 'ASSET', normalSide: 'DEBIT', isPostable: true, reportGroup: 'Fixed Assets' },
    { id: 'equity', code: '3-1000', name: 'Owner Equity', type: 'EQUITY', normalSide: 'CREDIT', isPostable: true, reportGroup: 'Equity' },
    { id: 'revenue', code: '4-1000', name: 'Sales Revenue', type: 'REVENUE', normalSide: 'CREDIT', isPostable: true, reportGroup: 'Revenue' },
    { id: 'expense', code: '5-1000', name: 'Operating Expense', type: 'EXPENSE', normalSide: 'DEBIT', isPostable: true, reportGroup: 'Operating' },
  ];

  // Beginning balances: opening cash of 1000 funded by equity.
  const beginningLines: JournalLineRecord[] = [
    { accountId: 'cash', debit: 1000, credit: 0 },
    { accountId: 'equity', debit: 0, credit: 1000 },
  ];

  // Period activity touching cash + non-cash accounts:
  //   - Credit sale:        AR +800,  Revenue +800
  //   - Collect part of AR:  Cash +500, AR -500
  //   - Pay expense in cash: Expense 300, Cash -300
  //   - Buy equipment cash:  Fixed +200, Cash -200
  // Net cash movement = +500 - 300 - 200 = 0, so ending cash == beginning cash.
  const periodLines: JournalLineRecord[] = [
    { accountId: 'ar', debit: 800, credit: 0 },
    { accountId: 'revenue', debit: 0, credit: 800 },
    { accountId: 'cash', debit: 500, credit: 0 },
    { accountId: 'ar', debit: 0, credit: 500 },
    { accountId: 'expense', debit: 300, credit: 0 },
    { accountId: 'cash', debit: 0, credit: 300 },
    { accountId: 'fixed', debit: 200, credit: 0 },
    { accountId: 'cash', debit: 0, credit: 200 },
  ];

  it('self-reconciles: beginningCash + netCashChange === endingCash', () => {
    const report: CashFlowStatementReport = buildCashFlowStatement(cfAccounts, beginningLines, periodLines);

    expect(report.summary.beginningCash).toBe(1000);
    expect(report.summary.endingCash).toBe(1000);
    // Indirect-method sections tie exactly to the real cash movement.
    expect(report.summary.reconciliationDifference).toBe(0);
    expect(
      report.summary.beginningCash + report.summary.netCashChange,
    ).toBe(report.summary.endingCash);

    // No reconciling line is injected when the statement already ties.
    const operating = report.sections.find((s) => s.id === 'operating')!;
    expect(operating.rows.some((r) => r.accountId === 'reconciling-difference')).toBe(false);
  });

  it('surfaces a non-zero reconciling difference when an account is omitted (misclassified)', () => {
    // Drop the Fixed-asset account from the chart so its 200 outflow is never
    // classified into the investing section. The cash account itself is always
    // summed (the equipment purchase still credited cash), so ending cash is
    // unchanged at 1000 — but the indirect-method sections now overstate the
    // net change by 200, breaking the tie to actual cash movement.
    const missingFixed = cfAccounts.filter((a) => a.id !== 'fixed');
    const report = buildCashFlowStatement(missingFixed, beginningLines, periodLines);

    // Cash account net for the period is +500 - 300 - 200 = 0, so cash is flat.
    expect(report.summary.beginningCash).toBe(1000);
    expect(report.summary.endingCash).toBe(1000);
    // netCashChange = operating(200) + investing(0, the -200 was dropped) + financing(0) = 200.
    expect(report.summary.netCashChange).toBe(200);
    // beginningCash(1000) + netCashChange(200) - endingCash(1000) = 200.
    expect(report.summary.reconciliationDifference).toBe(200);

    // The reconciling line is appended to operating so the statement visually ties.
    const operating = report.sections.find((s) => s.id === 'operating')!;
    const reconcileRow = operating.rows.find((r) => r.accountId === 'reconciling-difference');
    expect(reconcileRow).toBeDefined();
    expect(reconcileRow!.amount).toBe(-200);

    // After the reconciling line, the three subtotals tie to ending - beginning (= 0).
    const totalSubtotals =
      report.sections.reduce((s, sec) => s + sec.subtotal, 0);
    expect(totalSubtotals).toBe(report.summary.endingCash - report.summary.beginningCash);
  });
});
