// Module grouping for the two-level workspace (Accurate-style):
//   row 1 = modules, row 2 = the active module's document tabs.
// A tab's moduleKey decides which top-level module tab it lives under.
import type { TabTarget } from './types';

/** The module a tab belongs to. AR entities are document modules; everything
 *  else is a "page" module keyed by its area. */
export function moduleKeyOf(t: TabTarget): string {
    if (t.module === 'reports') return 'reports';
    if (t.module === 'ar') return `ar/${t.entity}`;
    if (t.module === 'ap') return `ap/${t.entity}`;
    if (t.module === 'page') return `page:${t.recordId}`; // recordId holds the page module key
    return t.module;
}

/** Document modules show a second row (catalog + records + new). Page modules
 *  render a single screen via <Outlet/> with no second row. */
const DOC_MODULE_TITLES: Record<string, string> = {
    'ar/sales-order': 'Sales orders',
    'ar/invoice': 'Invoices',
    'ar/customer': 'Customers',
    'ar/payment': 'Payments (AR)',
    'ar/credit-note': 'Returns & credits',
    'ar/delivery-note': 'Delivery notes',
    'stock-count': 'Stock counts',
    'banking': 'Banking',
    'reports': 'Reports',
    'ap/purchase-order': 'Purchase orders',
    'ap/bill': 'Bills',
    'ap/payment': 'Payments (AP)',
    'ap/vendor': 'Vendors',
    'ap/debit-note': 'Returns & debits',
};

export function isDocumentModule(moduleKey: string): boolean {
    return moduleKey in DOC_MODULE_TITLES;
}

export function docModuleTitle(moduleKey: string): string | undefined {
    return DOC_MODULE_TITLES[moduleKey];
}

/** Per-document-module config for the second row's catalog + "New" actions. */
export const DOC_MODULES: Record<string, {
    module: string;
    entity: string;
    title: string;
    newLabel?: string;
    listPath: string;
    newPath?: string;
}> = {
    'ar/sales-order': { module: 'ar', entity: 'sales-order', title: 'Sales orders', newLabel: 'New sales order', listPath: '/ar/sales-orders', newPath: '/ar/sales-orders/new' },
    'ar/invoice': { module: 'ar', entity: 'invoice', title: 'Invoices', newLabel: 'New invoice', listPath: '/ar/invoices', newPath: '/ar/invoices/new' },
    'ar/customer': { module: 'ar', entity: 'customer', title: 'Customers', newLabel: 'New customer', listPath: '/ar/customers', newPath: '/ar/customers/new' },
    'ar/payment': { module: 'ar', entity: 'payment', title: 'Payments (AR)', newLabel: 'Record payment', listPath: '/ar/payments', newPath: '/ar/payments/new' },
    'ar/credit-note': { module: 'ar', entity: 'credit-note', title: 'Returns & credits', newLabel: 'New sales return', listPath: '/ar/credits', newPath: '/ar/returns/new' },
    'ar/delivery-note': { module: 'ar', entity: 'delivery-note', title: 'Delivery notes', newLabel: 'New delivery note', listPath: '/ar/delivery-notes', newPath: '/ar/delivery-notes/new' },
    'stock-count': { module: 'stock-count', entity: 'count', title: 'Stock counts', newLabel: 'New count', listPath: '/inventory/counts', newPath: '/inventory/counts/new' },
    'banking': { module: 'banking', entity: 'transaction', title: 'Banking', newLabel: 'New payment', listPath: '/banking', newPath: '/banking/payment' },
    'reports': { module: 'reports', entity: 'catalog', title: 'Reports', listPath: '/reports' },
    'ap/purchase-order': { module: 'ap', entity: 'purchase-order', title: 'Purchase orders', newLabel: 'New PO', listPath: '/ap/pos', newPath: '/ap/pos/new' },
    'ap/bill': { module: 'ap', entity: 'bill', title: 'Bills', newLabel: 'New bill', listPath: '/ap/bills', newPath: '/ap/bills/new' },
    'ap/payment': { module: 'ap', entity: 'payment', title: 'Payments (AP)', newLabel: 'Pay bills', listPath: '/ap/payments', newPath: '/ap/payments/new' },
    'ap/vendor': { module: 'ap', entity: 'vendor', title: 'Vendors', newLabel: 'Add vendor', listPath: '/ap/vendors', newPath: '/ap/vendors/new?mode=create' },
    'ap/debit-note': { module: 'ap', entity: 'debit-note', title: 'Returns & debits', newLabel: 'New purchase return', listPath: '/ap/debits', newPath: '/ap/returns/new' },
};

// Map a non-AR route to its page module (one top tab per area; navigating
// within the area updates that tab's path). Longest-prefix match.
const PAGE_MODULES: Array<[string, { key: string; title: string }]> = [
    ['/banking/reconciliation', { key: 'reconciliation', title: 'Reconciliation' }],
    ['/reports/bank-reconciliation', { key: 'reports-reconciliation', title: 'Bank reconciliation' }],
    ['/settings', { key: 'settings', title: 'Settings' }],
    ['/company-setup', { key: 'company', title: 'Company setup' }],
    ['/integrations', { key: 'integrations', title: 'Integrations' }],
    ['/inventory', { key: 'inventory', title: 'Inventory' }],
    ['/ap/receiving', { key: 'receiving', title: 'Receive goods' }],
    ['/ap', { key: 'purchases', title: 'Purchases' }],
    ['/ar/recurring', { key: 'recurring', title: 'Recurring billing' }],
    ['/ar/approvals', { key: 'approvals', title: 'Approvals' }],
    ['/hr', { key: 'hr', title: 'HR & payroll' }],
    ['/assets', { key: 'assets', title: 'Assets' }],
    ['/gl', { key: 'gl', title: 'General ledger' }],
];

export function pageModuleForPath(path: string): { key: string; title: string } {
    if (path === '/') return { key: 'dashboard', title: 'Dashboard' };
    const hit = PAGE_MODULES.find(([prefix]) => path.startsWith(prefix));
    if (hit) return hit[1];
    const seg = path.split('/').filter(Boolean)[0] || 'page';
    return { key: seg, title: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ') };
}
