// Module grouping for the two-level workspace (Accurate-style):
//   row 1 = modules, row 2 = the active module's document tabs.
// A tab's moduleKey decides which top-level module tab it lives under.
import type { TabTarget } from './types';

/** The module a tab belongs to. AR entities are document modules; everything
 *  else is a "page" module keyed by its area. */
export function moduleKeyOf(t: TabTarget): string {
    if (t.module === 'ar') return `ar/${t.entity}`;
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
};

export function isDocumentModule(moduleKey: string): boolean {
    return moduleKey in DOC_MODULE_TITLES;
}

export function docModuleTitle(moduleKey: string): string | undefined {
    return DOC_MODULE_TITLES[moduleKey];
}

/** Per-document-module config for the second row's catalog + "New" actions. */
export const DOC_MODULES: Record<string, {
    entity: string;
    title: string;
    newLabel: string;
    listPath: string;
    newPath: string;
}> = {
    'ar/sales-order': { entity: 'sales-order', title: 'Sales orders', newLabel: 'New sales order', listPath: '/ar/sales-orders', newPath: '/ar/sales-orders/new' },
    'ar/invoice': { entity: 'invoice', title: 'Invoices', newLabel: 'New invoice', listPath: '/ar/invoices', newPath: '/ar/invoices/new' },
    'ar/customer': { entity: 'customer', title: 'Customers', newLabel: 'New customer', listPath: '/ar/customers', newPath: '/ar/customers/new' },
    'ar/payment': { entity: 'payment', title: 'Payments (AR)', newLabel: 'Record payment', listPath: '/ar/payments', newPath: '/ar/payments/new' },
};

// Map a non-AR route to its page module (one top tab per area; navigating
// within the area updates that tab's path). Longest-prefix match.
const PAGE_MODULES: Array<[string, { key: string; title: string }]> = [
    ['/banking', { key: 'banking', title: 'Banking' }],
    ['/reports', { key: 'reports', title: 'Reports' }],
    ['/settings', { key: 'settings', title: 'Settings' }],
    ['/company-setup', { key: 'company', title: 'Company setup' }],
    ['/integrations', { key: 'integrations', title: 'Integrations' }],
    ['/inventory', { key: 'inventory', title: 'Inventory' }],
    ['/ap/bills', { key: 'bills', title: 'Bills' }],
    ['/ap/pos', { key: 'pos', title: 'Purchase orders' }],
    ['/ap/receiving', { key: 'receiving', title: 'Receive goods' }],
    ['/ap/payments', { key: 'ap-payments', title: 'Payments (AP)' }],
    ['/ap/vendors', { key: 'vendors', title: 'Vendors' }],
    ['/ap', { key: 'purchases', title: 'Purchases' }],
    ['/ar/credits', { key: 'credits', title: 'Credit notes' }],
    ['/ar/delivery-notes', { key: 'delivery-notes', title: 'Delivery notes' }],
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
