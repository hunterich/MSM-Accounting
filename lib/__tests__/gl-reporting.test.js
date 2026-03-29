import { describe, expect, it } from 'vitest';
import {
  buildBalanceSheetReport,
  buildBalanceSheetMultiPeriodReport,
  buildProfitLossReport,
  buildTrialBalanceReport,
} from '../gl-reporting.js';

const accounts = [
  { id: 'cash', code: '1-1000', name: 'Cash', type: 'ASSET', normalSide: 'DEBIT', isPostable: true },
  { id: 'ar', code: '1-1200', name: 'Accounts Receivable', type: 'ASSET', normalSide: 'DEBIT', isPostable: true },
  { id: 'ap', code: '2-1000', name: 'Accounts Payable', type: 'LIABILITY', normalSide: 'CREDIT', isPostable: true },
  { id: 'equity', code: '3-1000', name: 'Retained Earnings', type: 'EQUITY', normalSide: 'CREDIT', isPostable: true },
  { id: 'revenue', code: '4-1000', name: 'Sales Revenue', type: 'REVENUE', normalSide: 'CREDIT', isPostable: true },
  { id: 'expense', code: '5-1000', name: 'Operating Expense', type: 'EXPENSE', normalSide: 'DEBIT', isPostable: true },
];

const postedLines = [
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
    const report = buildTrialBalanceReport(accounts, postedLines);

    expect(report.summary.totalDebit).toBe(2600);
    expect(report.summary.totalCredit).toBe(2600);
    expect(report.summary.endingDebit).toBe(2300);
    expect(report.summary.endingCredit).toBe(2300);
  });
});

describe('buildProfitLossReport', () => {
  it('summarizes revenue, expense, and net income', () => {
    const report = buildProfitLossReport(accounts, postedLines);

    expect(report.summary.totalRevenue).toBe(800);
    expect(report.summary.totalExpense).toBe(300);
    expect(report.summary.netIncome).toBe(500);
    expect(report.sections[0].rows).toHaveLength(1);
    expect(report.sections[1].rows).toHaveLength(1);
  });
});

describe('buildBalanceSheetReport', () => {
  it('adds current earnings into equity so the statement balances', () => {
    const report = buildBalanceSheetReport(accounts, postedLines);

    expect(report.summary.totalAssets).toBe(2000);
    expect(report.summary.totalLiabilities).toBe(500);
    expect(report.summary.totalEquity).toBe(1500);
    expect(report.summary.currentEarnings).toBe(500);
    expect(report.summary.totalLiabilitiesAndEquity).toBe(2000);

    const equitySection = report.sections.find((section) => section.id === 'EQUITY');
    expect(equitySection.rows.some((row) => row.accountName === 'Current Earnings')).toBe(true);
  });
});

describe('buildBalanceSheetMultiPeriodReport', () => {
  it('compares two balance sheet snapshots and computes variances', () => {
    const current = buildBalanceSheetReport(accounts, postedLines);
    const compare = buildBalanceSheetReport(accounts, [
      { accountId: 'cash', debit: 900, credit: 0 },
      { accountId: 'equity', debit: 0, credit: 900 },
    ]);

    const report = buildBalanceSheetMultiPeriodReport(current, compare);

    expect(report.summary.current.totalAssets).toBe(2000);
    expect(report.summary.compare.totalAssets).toBe(900);
    expect(report.summary.variance.totalAssets).toBe(1100);

    const assetSection = report.sections.find((section) => section.id === 'ASSET');
    const cashRow = assetSection.rows.find((row) => row.accountId === 'cash');
    expect(cashRow.currentAmount).toBe(1200);
    expect(cashRow.compareAmount).toBe(900);
    expect(cashRow.variance).toBe(300);
  });
});
