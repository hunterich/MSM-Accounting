/**
 * Single source of truth for the permission-matrix module list on the
 * Users & Roles page.
 *
 * The API (Prisma `enum ModuleKey`, UPPER_SNAKE) is authoritative: the matrix
 * is built from MODULE_DEFS below, and every row that round-trips to the server
 * uses the `ModuleKey` form. The client mock (`useAccessStore.MODULE_KEYS`,
 * lowercase) is NOT used here — this page reads/writes the real DB.
 *
 * Mapping between the two casings is a plain case fold:
 *   client `ar_invoices`  <->  API `AR_INVOICES`   (toUpperCase / toLowerCase)
 *
 * The client set has three keys with NO `ModuleKey` equivalent and they are
 * intentionally omitted from the matrix (the API can't store them):
 *   - ar_customer_categories
 *   - ap_vendor_categories
 *   - assets            (no ASSETS member in the Prisma enum)
 *
 * Every member of `enum ModuleKey` (prisma/schema.prisma) is represented below;
 * keep this list in sync if the enum changes.
 */

export interface ModuleDef {
  /** Prisma ModuleKey enum member — the API/source-of-truth key. */
  moduleKey: string;
  /** Human label for the matrix row. */
  label: string;
  /** Category used to group rows in the left rail. */
  group: string;
}

export const MODULE_GROUP_ORDER: string[] = [
  'Dashboard',
  'General Ledger',
  'Accounts Receivable',
  'Accounts Payable',
  'Inventory',
  'Point of Sale',
  'HR & Payroll',
  'Banking',
  'Integrations',
  'Reports',
  'Company',
  'Settings',
];

/**
 * One entry per `enum ModuleKey` member. Order within a group controls render
 * order in the matrix.
 */
export const MODULE_DEFS: ModuleDef[] = [
  { moduleKey: 'DASHBOARD', label: 'Dashboard', group: 'Dashboard' },

  { moduleKey: 'GL_COA', label: 'Chart of Accounts', group: 'General Ledger' },
  { moduleKey: 'GL_JOURNAL', label: 'Journal Entries', group: 'General Ledger' },

  { moduleKey: 'AR_SALES_ORDERS', label: 'Sales Orders', group: 'Accounts Receivable' },
  { moduleKey: 'AR_INVOICES', label: 'Invoices', group: 'Accounts Receivable' },
  { moduleKey: 'AR_PAYMENTS', label: 'Receive Payments', group: 'Accounts Receivable' },
  { moduleKey: 'AR_CREDITS', label: 'Returns & Credits', group: 'Accounts Receivable' },
  { moduleKey: 'AR_CUSTOMERS', label: 'Customers Master', group: 'Accounts Receivable' },

  { moduleKey: 'AP_POS', label: 'Purchase Orders', group: 'Accounts Payable' },
  { moduleKey: 'AP_BILLS', label: 'Purchase Bills', group: 'Accounts Payable' },
  { moduleKey: 'AP_PAYMENTS', label: 'Send Payments', group: 'Accounts Payable' },
  { moduleKey: 'AP_DEBITS', label: 'Returns & Debits', group: 'Accounts Payable' },
  { moduleKey: 'AP_VENDORS', label: 'Vendors Master', group: 'Accounts Payable' },

  { moduleKey: 'INV_ITEMS', label: 'Inventory Items', group: 'Inventory' },
  { moduleKey: 'INV_CATEGORIES', label: 'Item Categories', group: 'Inventory' },
  { moduleKey: 'INV_ADJ', label: 'Stock Adjustments', group: 'Inventory' },

  { moduleKey: 'POS_RETAIL', label: 'Point of Sale', group: 'Point of Sale' },

  { moduleKey: 'HR_EMPLOYEES', label: 'Employees', group: 'HR & Payroll' },
  { moduleKey: 'HR_ATTENDANCE', label: 'Attendance', group: 'HR & Payroll' },
  { moduleKey: 'HR_PAYROLL', label: 'Payroll Run', group: 'HR & Payroll' },

  { moduleKey: 'BANKING', label: 'Banking Registries', group: 'Banking' },

  { moduleKey: 'INTEGRATIONS', label: 'Integrations', group: 'Integrations' },

  { moduleKey: 'REPORTS', label: 'Financial Reports', group: 'Reports' },
  { moduleKey: 'POS_REPORTS', label: 'Sales Performance', group: 'Reports' },

  { moduleKey: 'COMPANY', label: 'Company Setup', group: 'Company' },

  { moduleKey: 'SETTINGS', label: 'Application Settings', group: 'Settings' },
  { moduleKey: 'SYSTEM_BACKUP', label: 'Backup & Restore', group: 'Settings' },
];

/** Grouped view of MODULE_DEFS for the left-rail / per-group rendering. */
export const MODULE_DEFS_BY_GROUP: Record<string, ModuleDef[]> = MODULE_DEFS.reduce(
  (acc: Record<string, ModuleDef[]>, def) => {
    (acc[def.group] ||= []).push(def);
    return acc;
  },
  {},
);
