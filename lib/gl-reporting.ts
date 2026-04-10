import { toNumber, asMoney } from './money';

export { toNumber, asMoney };

const EPSILON = 0.0001;

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

const SECTION_LABELS: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
};

const TYPE_ORDER: Record<AccountType, number> = {
  ASSET: 1,
  LIABILITY: 2,
  EQUITY: 3,
  REVENUE: 4,
  EXPENSE: 5,
};

export interface GlAccount {
  id: string;
  code?: string | null;
  name: string;
  type: AccountType | string;
  normalSide?: 'DEBIT' | 'CREDIT' | string;
  isPostable?: boolean;
  reportGroup?: string | null;
  reportSubGroup?: string | null;
}

export interface JournalLineRecord {
  accountId: string;
  debit?: number | string | { toNumber(): number } | null;
  credit?: number | string | { toNumber(): number } | null;
}

interface AccountTotals {
  totalDebit: number;
  totalCredit: number;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string | null | undefined;
  accountName: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  endingDebit: number;
  endingCredit: number;
}

export interface TrialBalanceSummary {
  totalDebit: number;
  totalCredit: number;
  endingDebit: number;
  endingCredit: number;
}

export interface TrialBalanceReport {
  rows: TrialBalanceRow[];
  summary: TrialBalanceSummary;
}

export interface SectionRow {
  accountId: string;
  accountCode: string | null | undefined;
  accountName: string;
  accountType: string;
  reportGroup: string | null;
  reportSubGroup: string | null;
  amount: number;
  isDerived?: boolean;
}

export interface ReportSection {
  id: string;
  label: string;
  rows: SectionRow[];
  total: number;
}

export interface ProfitLossSummary {
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

export interface ProfitLossReport {
  sections: ReportSection[];
  summary: ProfitLossSummary;
}

export interface BalanceSheetSummary {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentEarnings: number;
  totalLiabilitiesAndEquity: number;
}

export interface BalanceSheetReport {
  sections: ReportSection[];
  summary: BalanceSheetSummary;
}

export interface MultiPeriodRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  currentAmount: number;
  compareAmount: number;
  variance: number;
}

export interface MultiPeriodSection {
  id: string;
  label: string;
  rows: MultiPeriodRow[];
  totalCurrent: number;
  totalCompare: number;
  totalVariance: number;
}

export interface MultiPeriodVariance {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
}

export interface BalanceSheetMultiPeriodReport {
  sections: MultiPeriodSection[];
  summary: {
    current: BalanceSheetSummary;
    compare: BalanceSheetSummary;
    variance: MultiPeriodVariance;
  };
}

const hasAmount = (value: number): boolean => Math.abs(value) > EPSILON;

interface Sortable {
  accountType?: string;
  type?: string;
  accountCode?: string | null | undefined;
  code?: string | null | undefined;
}

const sortAccounts = (a: Sortable, b: Sortable): number => {
  const aType = (a.type || a.accountType || '') as AccountType;
  const bType = (b.type || b.accountType || '') as AccountType;
  const typeCompare = (TYPE_ORDER[aType] || 99) - (TYPE_ORDER[bType] || 99);
  if (typeCompare !== 0) return typeCompare;
  return String(a.code || a.accountCode || '').localeCompare(String(b.code || b.accountCode || ''));
};

const buildTotalsByAccount = (lines: JournalLineRecord[]): Map<string, AccountTotals> => {
  const totalsByAccount = new Map<string, AccountTotals>();

  for (const line of lines) {
    const current = totalsByAccount.get(line.accountId) || {
      totalDebit: 0,
      totalCredit: 0,
    };

    current.totalDebit = asMoney(current.totalDebit + toNumber(line.debit));
    current.totalCredit = asMoney(current.totalCredit + toNumber(line.credit));
    totalsByAccount.set(line.accountId, current);
  }

  return totalsByAccount;
};

const naturalBalance = (account: GlAccount, totals: AccountTotals | undefined): number => {
  const debit = toNumber(totals?.totalDebit);
  const credit = toNumber(totals?.totalCredit);
  return asMoney(account.normalSide === 'CREDIT' ? credit - debit : debit - credit);
};

const ledgerBalance = (totals: AccountTotals | undefined): number => {
  const debit = toNumber(totals?.totalDebit);
  const credit = toNumber(totals?.totalCredit);
  return asMoney(debit - credit);
};

export const buildTrialBalanceReport = (
  accounts: GlAccount[],
  lines: JournalLineRecord[],
): TrialBalanceReport => {
  const totalsByAccount = buildTotalsByAccount(lines);

  const rows: TrialBalanceRow[] = accounts
    .filter((account) => account.isPostable)
    .map((account) => {
      const totals = totalsByAccount.get(account.id) || { totalDebit: 0, totalCredit: 0 };
      const netLedgerBalance = ledgerBalance(totals);

      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        totalDebit: asMoney(totals.totalDebit),
        totalCredit: asMoney(totals.totalCredit),
        endingDebit: asMoney(Math.max(netLedgerBalance, 0)),
        endingCredit: asMoney(Math.max(-netLedgerBalance, 0)),
      };
    })
    .filter((row) =>
      hasAmount(row.totalDebit) ||
      hasAmount(row.totalCredit) ||
      hasAmount(row.endingDebit) ||
      hasAmount(row.endingCredit)
    )
    .sort(sortAccounts);

  const summary = rows.reduce<TrialBalanceSummary>((acc, row) => ({
    totalDebit: asMoney(acc.totalDebit + row.totalDebit),
    totalCredit: asMoney(acc.totalCredit + row.totalCredit),
    endingDebit: asMoney(acc.endingDebit + row.endingDebit),
    endingCredit: asMoney(acc.endingCredit + row.endingCredit),
  }), {
    totalDebit: 0,
    totalCredit: 0,
    endingDebit: 0,
    endingCredit: 0,
  });

  return { rows, summary };
};

const buildSectionRows = (
  accounts: GlAccount[],
  totalsByAccount: Map<string, AccountTotals>,
  eligibleTypes: string[],
): SectionRow[] => {
  return accounts
    .filter((account) => account.isPostable && eligibleTypes.includes(account.type))
    .map((account) => {
      const totals = totalsByAccount.get(account.id) || { totalDebit: 0, totalCredit: 0 };
      const amount = naturalBalance(account, totals);

      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        reportGroup: account.reportGroup || null,
        reportSubGroup: account.reportSubGroup || null,
        amount,
      };
    })
    .filter((row) => hasAmount(row.amount))
    .sort(sortAccounts);
};

export const buildProfitLossReport = (
  accounts: GlAccount[],
  lines: JournalLineRecord[],
): ProfitLossReport => {
  const totalsByAccount = buildTotalsByAccount(lines);
  const revenueRows = buildSectionRows(accounts, totalsByAccount, ['REVENUE']);
  const expenseRows = buildSectionRows(accounts, totalsByAccount, ['EXPENSE']);

  const totalRevenue = asMoney(revenueRows.reduce((sum, row) => sum + row.amount, 0));
  const totalExpense = asMoney(expenseRows.reduce((sum, row) => sum + row.amount, 0));
  const netIncome = asMoney(totalRevenue - totalExpense);

  const sections: ReportSection[] = [
    {
      id: 'REVENUE',
      label: SECTION_LABELS.REVENUE,
      rows: revenueRows,
      total: totalRevenue,
    },
    {
      id: 'EXPENSE',
      label: SECTION_LABELS.EXPENSE,
      rows: expenseRows,
      total: totalExpense,
    },
  ];

  return {
    sections,
    summary: {
      totalRevenue,
      totalExpense,
      netIncome,
    },
  };
};

export const buildBalanceSheetReport = (
  accounts: GlAccount[],
  lines: JournalLineRecord[],
): BalanceSheetReport => {
  const totalsByAccount = buildTotalsByAccount(lines);
  const assetRows = buildSectionRows(accounts, totalsByAccount, ['ASSET']);
  const liabilityRows = buildSectionRows(accounts, totalsByAccount, ['LIABILITY']);
  const equityRows = buildSectionRows(accounts, totalsByAccount, ['EQUITY']);
  const profitLoss = buildProfitLossReport(accounts, lines);

  if (hasAmount(profitLoss.summary.netIncome)) {
    equityRows.push({
      accountId: 'current-earnings',
      accountCode: '',
      accountName: 'Current Earnings',
      accountType: 'EQUITY',
      reportGroup: 'Equity',
      reportSubGroup: 'Current Earnings',
      amount: profitLoss.summary.netIncome,
      isDerived: true,
    });
  }

  const sortedEquityRows = [...equityRows].sort(sortAccounts);
  const totalAssets = asMoney(assetRows.reduce((sum, row) => sum + row.amount, 0));
  const totalLiabilities = asMoney(liabilityRows.reduce((sum, row) => sum + row.amount, 0));
  const totalEquity = asMoney(sortedEquityRows.reduce((sum, row) => sum + row.amount, 0));
  const totalLiabilitiesAndEquity = asMoney(totalLiabilities + totalEquity);

  const sections: ReportSection[] = [
    {
      id: 'ASSET',
      label: SECTION_LABELS.ASSET,
      rows: assetRows,
      total: totalAssets,
    },
    {
      id: 'LIABILITY',
      label: SECTION_LABELS.LIABILITY,
      rows: liabilityRows,
      total: totalLiabilities,
    },
    {
      id: 'EQUITY',
      label: SECTION_LABELS.EQUITY,
      rows: sortedEquityRows,
      total: totalEquity,
    },
  ];

  return {
    sections,
    summary: {
      totalAssets,
      totalLiabilities,
      totalEquity,
      currentEarnings: profitLoss.summary.netIncome,
      totalLiabilitiesAndEquity,
    },
  };
};

export const buildBalanceSheetMultiPeriodReport = (
  currentReport: BalanceSheetReport,
  compareReport: BalanceSheetReport,
): BalanceSheetMultiPeriodReport => {
  const currentSections = currentReport.sections || [];
  const compareSections = compareReport.sections || [];
  const compareSectionById = new Map(compareSections.map((section) => [section.id, section]));

  const mergeSection = (currentSection: ReportSection): MultiPeriodSection => {
    const compareSection = compareSectionById.get(currentSection.id) || { rows: [], total: 0 };
    const rowMap = new Map<string, { accountId: string; accountCode: string; accountName: string; currentAmount: number; compareAmount: number }>();

    for (const row of currentSection.rows || []) {
      rowMap.set(row.accountId, {
        accountId: row.accountId,
        accountCode: row.accountCode || '',
        accountName: row.accountName,
        currentAmount: row.amount,
        compareAmount: 0,
      });
    }

    for (const row of compareSection.rows || []) {
      const existing = rowMap.get(row.accountId);
      if (existing) {
        existing.compareAmount = row.amount;
      } else {
        rowMap.set(row.accountId, {
          accountId: row.accountId,
          accountCode: row.accountCode || '',
          accountName: row.accountName,
          currentAmount: 0,
          compareAmount: row.amount,
        });
      }
    }

    const rows: MultiPeriodRow[] = Array.from(rowMap.values())
      .map((row) => ({
        ...row,
        variance: asMoney(row.currentAmount - row.compareAmount),
      }))
      .filter((row) => hasAmount(row.currentAmount) || hasAmount(row.compareAmount) || hasAmount(row.variance))
      .sort((a, b) => String(a.accountCode || '').localeCompare(String(b.accountCode || '')));

    return {
      id: currentSection.id,
      label: currentSection.label,
      rows,
      totalCurrent: asMoney(currentSection.total || 0),
      totalCompare: asMoney((compareSection as ReportSection).total || 0),
      totalVariance: asMoney((currentSection.total || 0) - ((compareSection as ReportSection).total || 0)),
    };
  };

  const sections = currentSections.map(mergeSection);

  return {
    sections,
    summary: {
      current: currentReport.summary,
      compare: compareReport.summary,
      variance: {
        totalAssets: asMoney((currentReport.summary.totalAssets || 0) - (compareReport.summary.totalAssets || 0)),
        totalLiabilities: asMoney((currentReport.summary.totalLiabilities || 0) - (compareReport.summary.totalLiabilities || 0)),
        totalEquity: asMoney((currentReport.summary.totalEquity || 0) - (compareReport.summary.totalEquity || 0)),
        totalLiabilitiesAndEquity: asMoney((currentReport.summary.totalLiabilitiesAndEquity || 0) - (compareReport.summary.totalLiabilitiesAndEquity || 0)),
      },
    },
  };
};

export const getGlSectionLabel = (type: string): string =>
  SECTION_LABELS[type as AccountType] || type;
