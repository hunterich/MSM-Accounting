import type { ModuleKey } from '@prisma/client';
import type { PermissionDescriptor } from '@/lib/authz';

/**
 * Who may read the records that several screens share (issue #234).
 *
 * Rule: a GET is guarded by `view` on the module that owns the records — the
 * same module its POST/PUT/DELETE already use. Some records are also read by
 * other screens: the account picker sits on every posting form, the customer
 * list feeds invoices, payments and returns, and so on. For those, `view` on
 * ANY module whose screen reads the records is enough. Each list below names
 * those screens, so a change to who reads a lookup is a change here, in one
 * reviewed place.
 *
 * How the lists were built: every `api.get('/api/v1/...')` in `src/hooks` and
 * `src/views`, traced to the screens that call it, and each screen to its
 * permission key in `SUBITEM_PERMISSION_MAP` / `WIDGET_REGISTRY` on the client.
 * Dashboard widgets are already hidden unless the user can view the widget's
 * own module (`src/config/dashboardWidgets.ts`), so DASHBOARD alone grants no
 * lookup.
 *
 * Never list a module whose users do not read the records: a scope is only as
 * tight as its longest list.
 */
export const READ_SCOPES = {
  /**
   * Chart of accounts (`accounts`, `accounts/[id]`). Every form that posts to
   * the ledger resolves its accounts against this list: invoices, payments,
   * credit/debit notes and returns, bills and purchase orders, bank actions,
   * journals, stock adjustments, item and vendor defaults, employee and payroll
   * accounts, report filters, marketplace shop mapping, POS sales types and the
   * account defaults in Settings. Account balances stay behind GL_COA
   * (`accounts/balances`).
   */
  accounts: [
    'GL_COA', 'GL_JOURNAL',
    'AR_INVOICES', 'AR_PAYMENTS', 'AR_CREDITS',
    'AP_POS', 'AP_BILLS', 'AP_PAYMENTS', 'AP_DEBITS', 'AP_VENDORS',
    'INV_ITEMS', 'INV_ADJ',
    'HR_EMPLOYEES', 'HR_PAYROLL',
    'BANKING', 'INTEGRATIONS', 'REPORTS', 'SETTINGS', 'POS_RETAIL',
  ],

  /**
   * Customer master (`customers`, `customers/[id]`). Picked on sales orders,
   * invoices, receive-payment, credit notes and sales returns, recurring
   * billing, marketplace shop mapping, and the report customer filter
   * (`ReportEntitySelect`).
   */
  customers: [
    'AR_CUSTOMERS', 'AR_SALES_ORDERS', 'AR_INVOICES', 'AR_PAYMENTS', 'AR_CREDITS',
    'INTEGRATIONS', 'REPORTS',
  ],

  /**
   * Vendor master (`vendors`, `vendors/[id]`). Picked on purchase orders,
   * bills and bill import, send-payment, debit notes and purchase returns,
   * recurring expenses, and the report vendor filter (`ReportEntitySelect`).
   */
  vendors: ['AP_VENDORS', 'AP_POS', 'AP_BILLS', 'AP_PAYMENTS', 'AP_DEBITS', 'REPORTS'],

  /**
   * Item master (`items`, `items/[id]`). Picked on sales orders, invoices,
   * sales returns, purchase orders, bills, purchase returns, stock adjustments
   * and stock counts, matched by marketplace imports, and picked in the report
   * item filter (`ReportEntitySelect`).
   */
  items: [
    'INV_ITEMS', 'INV_ADJ',
    'AR_SALES_ORDERS', 'AR_INVOICES', 'AR_CREDITS',
    'AP_POS', 'AP_BILLS', 'AP_DEBITS',
    'INTEGRATIONS', 'REPORTS',
  ],

  /**
   * Item categories (`item-categories`, `item-categories/[id]`). Used by the
   * item form and list, stock counts, stock valuation and report filters, and
   * POS modifier settings.
   */
  itemCategories: ['INV_CATEGORIES', 'INV_ITEMS', 'INV_ADJ', 'REPORTS', 'POS_RETAIL'],

  /**
   * Warehouses (`warehouses`, `warehouses/[id]`). Chosen wherever stock moves:
   * sales and purchase documents, delivery notes, returns and notes, stock
   * counts and adjustments, and the stock valuation report.
   */
  warehouses: [
    'INV_ITEMS', 'INV_ADJ',
    'AR_SALES_ORDERS', 'AR_INVOICES', 'AR_CREDITS',
    'AP_POS', 'AP_BILLS', 'AP_DEBITS',
    'REPORTS',
  ],

  /**
   * Bank and cash accounts (`bank-accounts`, `bank-accounts/[id]`). Chosen as
   * the cash account on receive/send payments and on note refunds, and read by
   * the banking screens, marketplace settlement mapping and report filters.
   */
  bankAccounts: [
    'BANKING', 'AR_PAYMENTS', 'AP_PAYMENTS', 'AR_CREDITS', 'AP_DEBITS',
    'INTEGRATIONS', 'REPORTS',
  ],

  /**
   * Accounting periods (`accounting-periods`, `accounting-periods/[id]`). Only
   * dates and open/closed status. Every posting form reads them for the
   * closed-period banner (`usePeriodLock`), and Company Setup lists them. Closing
   * and editing periods stays behind SETTINGS.
   */
  accountingPeriods: [
    'GL_JOURNAL',
    'AR_INVOICES', 'AR_PAYMENTS', 'AR_CREDITS',
    'AP_BILLS', 'AP_PAYMENTS', 'AP_DEBITS',
    'BANKING', 'INV_ADJ',
    'SETTINGS', 'COMPANY',
  ],

  /**
   * Period-close checklist and fiscal-year close preview. Shown on Company
   * Setup (COMPANY) next to the close buttons, which need SETTINGS/edit.
   */
  periodClose: ['SETTINGS', 'COMPANY'],

  /**
   * Sales invoices (`invoices`, `invoices/[id]`, `invoices/[id]/settlement`).
   * Owned by AR_INVOICES; also listed by the sales-order form (invoiced
   * quantities), receive-payment (open invoices and what is still owed), and
   * credit notes / sales returns (the invoice being credited).
   */
  invoices: ['AR_INVOICES', 'AR_SALES_ORDERS', 'AR_PAYMENTS', 'AR_CREDITS'],

  /**
   * Purchase bills (`bills`, `bills/[id]`, `bills/[id]/settlement`). Owned by
   * AP_BILLS; also listed by send-payment (open bills and what is still owed)
   * and debit notes / purchase returns (the bill being returned against).
   */
  bills: ['AP_BILLS', 'AP_PAYMENTS', 'AP_DEBITS'],

  /**
   * Purchase-order lines still to bill. Owned by AP_POS; the bill form reads
   * them to bill against a receipt.
   */
  billablePoLines: ['AP_POS', 'AP_BILLS'],

  /**
   * Fixed assets and asset categories. Owned by GL_JOURNAL (no ASSETS module);
   * the bill form reads both to record an asset purchase.
   */
  assets: ['GL_JOURNAL', 'AP_BILLS'],

  /**
   * Departments and positions. Writes sit under HR_ATTENDANCE, but the employee
   * form and list are what read them.
   */
  hrStructure: ['HR_EMPLOYEES', 'HR_ATTENDANCE'],
} as const satisfies Record<string, readonly ModuleKey[]>;

export type ReadScope = keyof typeof READ_SCOPES;

/** `view` on any module of a shared read scope, for `withPermission`. */
export function readScope(scope: ReadScope): PermissionDescriptor {
  return { module: READ_SCOPES[scope], action: 'view' };
}
