import type React from 'react';

// ── Domain types ────────────────────────────────────────────────────────────────

/** All known report IDs expressed as a discriminated union. */
export type ReportType =
  | 'ar-control-reconciliation'
  | 'ap-control-reconciliation'
  | 'by-customer'
  | 'by-item'
  | 'by-item-customer'
  | 'history'
  | 'sales-return-list'
  | 'monthly-chart'
  | 'share-by-customer'
  | 'share-by-item'
  | 'aging'
  | 'customer-balance'
  | 'overdue-list'
  | 'statement'
  | 'trial-balance'
  | 'balance-sheet'
  | 'balance-sheet-multi-period'
  | 'profit-loss'
  | 'profit-loss-multi-period'
  | 'account-ledger'
  | 'cash-flow-statement'
  | 'ap-aging'
  | 'ap-vendor-balance'
  | 'ap-overdue-list'
  | 'ap-statement'
  | 'cash-flow'
  | 'stock-movement'
  | 'stock-valuation'
  | 'pph21-summary'
  | 'bank-reconciliation'
  | 'bank-history'
  | 'bank-received'
  | 'bank-payment';

/** Category IDs available in the sidebar. */
export type ReportCategoryId = 'sales' | 'gl' | 'banking' | 'ar' | 'ap' | 'inventory' | 'hr';

/** How a report is filtered: by date-range, as-of a single date, a current
 *  inventory snapshot (category/warehouse filters), or a per-party statement
 *  (party picker + date range). */
export type FilterMode = 'date-range' | 'as-of' | 'inventory-snapshot' | 'statement' | 'bank-period';

/** Report card visual type. */
export type ReportCardType = 'table' | 'chart';

/** Metadata describing a single report card. */
export interface ReportDefinition {
  id: ReportType;
  category: ReportCategoryId;
  apiPath: string;
  name: string;
  description: string;
  type: ReportCardType;
  filterMode: FilterMode;
  /** bank-period reports: require a specific bank (Received/Payment) vs allow "All banks" (History). */
  bankRequired?: boolean;
}

/** Query parameters sent to the API for a given report run. */
export interface ReportParams {
  kind?: 'ar' | 'ap';
  type: ReportType;
  dateFrom?: string;
  dateTo?: string;
  asOfDate?: string;
  compareAsOfDate?: string;
  compareDateFrom?: string;
  compareDateTo?: string;
  customerSearch?: string;
  itemSearch?: string;
  topN?: number;
  sortBy?: 'total' | 'qty';
  status?: string;
  accountId?: string;
  categoryId?: string;
  warehouseId?: string;
  customerId?: string;
  vendorId?: string;
  bankAccountId?: string;
}

/** One open report tab entry. */
export interface OpenReportEntry {
  report: ReportDefinition;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any; // raw API payload — shape differs per report type
  params: ReportParams;
  dateFrom: string | null;
  dateTo: string | null;
  asOfDate: string | null;
}

// ── Per-report row shapes ──────────────────────────────────────────────────────

export interface CustomerDayRow {
  date: string;
  invoiceCount: number;
  total: number;
}

export interface SalesByCustomerRow {
  customerId?: string;
  customerName: string;
  invoiceCount: number;
  total: number;
}

export interface SalesByItemRow {
  description: string;
  qty: number;
  total: number;
}

export interface SalesByItemCustomerRow {
  customerName: string;
  description: string;
  qty: number;
  total: number;
}

export interface SalesHistoryRow {
  number: string;
  issueDate: string;
  customerName: string;
  status: string;
  totalAmount: number;
}

export interface SalesReturnListRow {
  id: string;
  number: string;
  returnDate: string;
  customerName: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
}

export interface SalesShareItemRow {
  description: string;
  total: number;
  isOthers: boolean;
}

export interface SalesMonthlyRow {
  month: string; // "YYYY-MM"
  total: number;
}

export interface SalesShareRow {
  customerName: string;
  total: number;
  isOthers?: boolean;
}

export interface AgingRow {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customerName: string;
  daysOverdue: number;
  originalAmount: number;
  clearedAmount: number;
  balance: number;
  current: number;
  d1To30: number;
  d31To60: number;
  d61To90: number;
  d90Plus: number;
}

export interface AgingSummary {
  current: number;
  d1To30: number;
  d31To60: number;
  d61To90: number;
  d90Plus: number;
  totalOutstanding: number;
}

export interface CustomerBalanceRow {
  customerId: string;
  customerCode?: string;
  customerName: string;
  invoicedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}

export interface CustomerBalanceSummary {
  customerCount: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
}

export interface OverdueRow {
  invoiceId: string;
  invoiceNumber: string;
  dueDate: string | null;
  customerName: string;
  daysOverdue: number;
  status: string;
  balance: number;
}

export interface OverdueSummary {
  overdueInvoiceCount: number;
  overdueAmount: number;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
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

export interface PLRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface PLSection {
  id: string;
  label: string;
  rows: PLRow[];
  total: number;
}

export interface PLSummary {
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

export interface BalanceSheetRow {
  accountId: string;
  accountCode?: string;
  accountName: string;
  amount: number;
}

export interface BalanceSheetSection {
  id: string;
  label: string;
  rows: BalanceSheetRow[];
  total: number;
}

export interface BalanceSheetSummary {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
}

export interface BalanceSheetMultiRow {
  accountId: string;
  accountCode?: string;
  accountName: string;
  currentAmount: number;
  compareAmount: number;
  variance: number;
}

export interface BalanceSheetMultiSection {
  id: string;
  label: string;
  rows: BalanceSheetMultiRow[];
  totalCurrent: number;
  totalCompare: number;
  totalVariance: number;
}

export interface BalanceSheetMultiTotals {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export interface BalanceSheetMultiSummary {
  current: BalanceSheetMultiTotals;
  compare: BalanceSheetMultiTotals;
  variance: BalanceSheetMultiTotals;
}

// ── AP Aging ───────────────────────────────────────────────────────────────────

export interface APAgingRow {
  id: string;
  vendorName: string;
  billDate: string;
  dueDate: string;
  daysOverdue: number;
  balance: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export interface APAgingSummary {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  balance: number;
}

// ── Cash Flow ──────────────────────────────────────────────────────────────────

export interface CashFlowRow {
  bankAccountId: string;
  bankAccountName: string;
  date: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface CashFlowSummary {
  totalInflow: number;
  totalOutflow: number;
  totalNet: number;
}

export interface BankHistoryRow {
  bankTransactionId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  journalEntryNo: string | null;
  txnNumber: string | null;
  date: string;
  description: string;
  counterparty: string;
  reference: string | null;
  moneyIn: number;
  moneyOut: number;
  runningBalance: number;
}
export interface BankHistoryGroup {
  bankAccountId: string;
  bankAccountName: string;
  bankName: string | null;
  accountCode: string | null;
  openingBalance: number;
  rows: BankHistoryRow[];
  totalIn: number;
  totalOut: number;
  closingBalance: number;
}
export interface BankHistoryData { banks: BankHistoryGroup[]; summary: { totalIn: number; totalOut: number; netChange: number }; }

export interface BankDetailRow {
  bankTransactionId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  journalEntryNo: string | null;
  txnNumber: string | null;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  from?: string;   // bank-received
  payee?: string;  // bank-payment
}
export interface BankReceivedData { rows: BankDetailRow[]; summary: { count: number; totalReceived: number }; bankAccount: { id: string; name: string } | null; }
export interface BankPaymentData { rows: BankDetailRow[]; summary: { count: number; totalPaid: number }; bankAccount: { id: string; name: string } | null; }

// ── Bank Reconciliation ────────────────────────────────────────────────────────

export interface BankReconciliationRow {
  accountId: string;
  accountName: string;
  accountCode: string | null;
  bankName: string | null;
  bookBalance: number;
  statementEndBalance: number | null;
  variance: number | null;
  totalLines: number;
  matchedCount: number;
  unmatchedCount: number;
  unmatchedAmount: number;
  lastStatementDate: string | null;
  // Allow shared `Table` component to accept this row type.
  [key: string]: unknown;
}

export interface BankReconciliationSummary {
  totalAccounts: number;
  totalUnmatched: number;
  totalUnmatchedAmount: number;
}

// ── Stock Movement ─────────────────────────────────────────────────────────────

export interface StockMovementRow {
  itemId: string;
  sku: string;
  itemName: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  closingBalance: number;
}

// ── Customer / Vendor Statement ─────────────────────────────────────────────────
// Shape returned by GET /api/v1/reports/{ar,ap}?type=statement.
export interface StatementRow {
  date: string;
  type: string;
  number: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface StatementData {
  party: { id: string; code: string | null; name: string };
  period: { dateFrom: string; dateTo: string };
  openingBalance: number;
  rows: StatementRow[];
  summary: {
    totalDebits: number;
    totalCredits: number;
    closingBalance: number;
    aging: { current: number; d1To30: number; d31To60: number; d61To90: number; d90Plus: number };
  };
}

// ── Stock Valuation ────────────────────────────────────────────────────────────
// Shape returned by GET /api/v1/inventory/valuation (items[] + summary).
export interface StockValuationItem {
  itemId: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unit: string;
  totalQty: number;
  avgCost: number;
  totalValue: number;
}

export interface StockValuationData {
  items: StockValuationItem[];
  summary: { totalItems: number; totalValue: number };
}

// ── P&L Comparative ──────────────────────────────────────────────────────────

export interface PLComparativeRow {
  code: string;
  name: string;
  currentAmount: number;
  compareAmount: number;
  variance: number;
  variancePct: number;
}

export interface PLComparativeSection {
  id: string;
  label: string;
  rows: PLComparativeRow[];
  subtotal: { current: number; compare: number; variance: number; variancePct: number };
}

export interface PLComparativeSummary {
  currentRevenue: number;
  compareRevenue: number;
  revenueVariance: number;
  currentExpenses: number;
  compareExpenses: number;
  expensesVariance: number;
  currentNetIncome: number;
  compareNetIncome: number;
  netIncomeVariance: number;
  netIncomeVariancePct: number;
}

// ── AP Vendor Balance ────────────────────────────────────────────────────────

export interface APVendorBalanceRow {
  vendorCode: string;
  vendorName: string;
  billedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}

export interface APVendorBalanceSummary {
  vendorCount: number;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
}

// ── AP Overdue List ──────────────────────────────────────────────────────────

export interface APOverdueRow {
  billId: string;
  billNumber: string;
  dueDate: string;
  vendorName: string;
  daysOverdue: number;
  status: string;
  balance: number;
}

export interface APOverdueSummary {
  overdueBillCount: number;
  overdueAmount: number;
}

// ── Account Ledger ───────────────────────────────────────────────────────────

export interface AccountLedgerRow {
  date: string;
  entryNo: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

// ── Cash Flow Statement ──────────────────────────────────────────────────────

export interface CashFlowStatementRow {
  code: string;
  name: string;
  amount: number;
}

export interface CashFlowStatementSection {
  id: string;
  label: string;
  rows: CashFlowStatementRow[];
  subtotal: number;
}

export interface CashFlowStatementSummary {
  netCashChange: number;
  beginningCash: number;
  endingCash: number;
  reconciliationDifference?: number;
}

// ── PPh 21 Summary ───────────────────────────────────────────────────────────

export interface PPh21Row {
  employeeNo: string;
  employeeName: string;
  npwp: string;
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
}

export interface PPh21Summary {
  employeeCount: number;
  totalGrossPay: number;
  totalPph21: number;
  totalBpjsEmployee: number;
  totalBpjsEmployer: number;
  totalNetPay: number;
}

/** Column definition used for dynamic table rendering (not yet used but exported for future use). */
export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  format?: (value: unknown) => React.ReactNode;
}
