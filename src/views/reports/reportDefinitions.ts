import { ArrowDownLeft, ArrowUpRight, BookOpen, Landmark, Package, ShoppingCart, Users, type LucideIcon } from 'lucide-react';
import type { ReportCategoryId, ReportDefinition } from './reportTypes';

// ── Category metadata ──────────────────────────────────────────────────────────

interface CategoryMeta {
  id: ReportCategoryId;
  label: string;
  icon: LucideIcon;
}

// ── Static data ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: CategoryMeta[] = [
  { id: 'sales', label: 'Sales', icon: ShoppingCart },
  { id: 'gl', label: 'General Ledger', icon: BookOpen },
  { id: 'banking', label: 'Cash & Bank', icon: Landmark },
  { id: 'ar', label: 'Receivables', icon: ArrowDownLeft },
  { id: 'ap', label: 'Payables', icon: ArrowUpRight },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'hr', label: 'HR & Payroll', icon: Users },
];

const SALES_REPORTS: ReportDefinition[] = [
  {
    id: 'by-customer',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Sales by Customer',
    description: 'Net sales including PPN, after all applied credit notes in their own period, including refunds and price adjustments',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'by-item',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Sales by Item (Gross)',
    description: 'Gross invoice line subtotals before credit notes and excluding PPN',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'by-item-customer',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Item Sales by Customer (Gross)',
    description: 'Gross invoice line subtotals per customer before credit notes and excluding PPN',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'history',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Sales History',
    description: 'Lists sales invoice history with status',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'sales-return-list',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Sales Return List',
    description: 'Lists sales returns with the original invoice and status',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'monthly-chart',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Monthly Sales Chart',
    description: 'Monthly net sales including PPN, after all applied credit notes in the credit note month',
    type: 'chart',
    filterMode: 'date-range',
  },
  {
    id: 'share-by-customer',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Sales Share by Customer',
    description: 'Customer share of net sales including PPN and all applied credit notes; the rest grouped as Others',
    type: 'chart',
    filterMode: 'date-range',
  },
  {
    id: 'share-by-item',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Portion of Sales per Item (Gross)',
    description: 'Item share of gross invoice line subtotals before credit notes and excluding PPN',
    type: 'chart',
    filterMode: 'date-range',
  },
];

const AR_REPORTS: ReportDefinition[] = [
  { id: 'ar-control-reconciliation', category: 'ar', apiPath: '/api/v1/reports/control-reconciliation', name: 'AR Control Reconciliation', description: 'Compare each control account with the independent subledger; review named differences, advances and opening balances.', type: 'table', filterMode: 'as-of' },
  {
    id: 'aging',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'AR Aging',
    description: 'Lists open receivables per invoice with aging buckets.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'customer-balance',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'AR Customer Balance',
    description: 'Summarises total invoiced, payments, and outstanding receivables per customer.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'overdue-list',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'Overdue Invoices',
    description: 'Lists past-due AR invoices for collection follow-up.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'statement',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'Customer Statement',
    description: 'Statement of account for one customer: opening balance, transactions, running balance, and aging.',
    type: 'table',
    filterMode: 'statement',
  },
];

const GL_REPORTS: ReportDefinition[] = [
  {
    id: 'trial-balance',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Trial Balance',
    description: 'Shows debit, credit, and ending balances by general ledger account.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'balance-sheet',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Balance Sheet (Standard)',
    description: 'Shows assets, liabilities, and equity as of a selected date.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'balance-sheet-multi-period',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Balance Sheet (Multi-Period)',
    description: 'Compares two balance sheet dates side by side with variance.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'profit-loss',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Profit & Loss',
    description: 'Shows revenue, expenses, and net income for the selected period.',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'profit-loss-multi-period',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'P&L Comparative',
    description: 'Compares profit & loss across two periods side-by-side with variance.',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'account-ledger',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Account Ledger',
    description: 'Lists journal transactions and running balance for a single account.',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'cash-flow-statement',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Cash Flow Statement',
    description: 'Shows cash flows from operating, investing, and financing activities.',
    type: 'table',
    filterMode: 'date-range',
  },
];

const AP_REPORTS: ReportDefinition[] = [
  { id: 'ap-control-reconciliation', category: 'ap', apiPath: '/api/v1/reports/control-reconciliation', name: 'AP Control Reconciliation', description: 'Compare each control account with the independent subledger; review named differences, advances and opening balances.', type: 'table', filterMode: 'as-of' },
  {
    id: 'ap-aging',
    category: 'ap',
    apiPath: '/api/v1/reports/ap',
    name: 'AP Aging',
    description: 'Shows open bills per vendor with aging buckets (Current/1-30/31-60/61-90/90+).',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'ap-vendor-balance',
    category: 'ap',
    apiPath: '/api/v1/reports/ap',
    name: 'AP Vendor Balance',
    description: 'Summarises total billed, payments, and outstanding payables per vendor.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'ap-overdue-list',
    category: 'ap',
    apiPath: '/api/v1/reports/ap',
    name: 'Overdue Bills',
    description: 'Lists past-due AP bills.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'ap-statement',
    category: 'ap',
    apiPath: '/api/v1/reports/ap',
    name: 'Vendor Statement',
    description: 'Statement of account for one vendor: opening balance, transactions, running balance, and aging.',
    type: 'table',
    filterMode: 'statement',
  },
];

const BANKING_REPORTS: ReportDefinition[] = [
  {
    id: 'cash-flow',
    category: 'banking',
    apiPath: '/api/v1/reports/gl',
    name: 'Cash Flow',
    description: 'Shows inflows, outflows, and net cash per bank account for a date range.',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'bank-reconciliation',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Bank Reconciliation',
    description: 'Shows book balance vs statement balance with matched/unmatched counts and variance per bank account.',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'bank-history',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Bank History',
    description: 'Passbook of all movements per bank with a running balance (Mutasi Bank).',
    type: 'table',
    filterMode: 'bank-period',
    bankRequired: false,
  },
  {
    id: 'bank-received',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Detail Received per Bank',
    description: 'Money received by a bank in a period — income plus incoming transfers.',
    type: 'table',
    filterMode: 'bank-period',
    bankRequired: true,
  },
  {
    id: 'bank-payment',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Detail Payment per Bank',
    description: 'Money paid out of a bank in a period — expense plus outgoing transfers.',
    type: 'table',
    filterMode: 'bank-period',
    bankRequired: true,
  },
];

const INVENTORY_REPORTS: ReportDefinition[] = [
  {
    id: 'stock-movement',
    category: 'inventory',
    apiPath: '/api/v1/reports/gl',
    name: 'Stock Movement',
    description: 'Shows per-item opening balance, total in/out, and closing balance for a period.',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'stock-valuation',
    category: 'inventory',
    apiPath: '/api/v1/inventory/valuation',
    name: 'Stock Valuation',
    description: 'Inventory value per item at the selected date, filterable by category and warehouse.',
    type: 'table',
    filterMode: 'inventory-snapshot',
  },
];

const HR_REPORTS: ReportDefinition[] = [
  {
    id: 'pph21-summary',
    category: 'hr',
    apiPath: '/api/v1/reports/hr',
    name: 'PPh 21 Summary',
    description: 'Summarises PPh 21 withholding, BPJS contributions, and net pay per employee.',
    type: 'table',
    filterMode: 'date-range',
  },
];

export const REPORTS_BY_CATEGORY: Partial<Record<ReportCategoryId, ReportDefinition[]>> = {
  sales: SALES_REPORTS,
  gl: GL_REPORTS,
  ar: AR_REPORTS,
  ap: AP_REPORTS,
  banking: BANKING_REPORTS,
  inventory: INVENTORY_REPORTS,
  hr: HR_REPORTS,
};

/** Flat list of every report definition, for looking a report up by id. */
export const ALL_REPORTS: ReportDefinition[] = Object.values(REPORTS_BY_CATEGORY).flat() as ReportDefinition[];

/** Find a report definition by its id (used by the workspace report tab). */
export function findReportById(id: string | undefined | null): ReportDefinition | undefined {
  if (!id) return undefined;
  return ALL_REPORTS.find((r) => r.id === id);
}

export const IMPLEMENTED_CATEGORIES: CategoryMeta[] = ALL_CATEGORIES.filter((category) => {
  const reports = REPORTS_BY_CATEGORY[category.id];
  return Array.isArray(reports) && reports.length > 0;
});

export const DEFAULT_CATEGORY: ReportCategoryId = (IMPLEMENTED_CATEGORIES[0]?.id ?? 'sales') as ReportCategoryId;
