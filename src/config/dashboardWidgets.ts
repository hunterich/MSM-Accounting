export interface WidgetDefinition {
    id: string;
    label: string;
    description: string;
    permission: string;
    size: 'sm' | 'lg';
    requiresApproveRight?: boolean;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
    { id: 'monthly_sales', label: 'Sales This Month', description: 'Monthly sales, settled invoices, and current outstanding balances', permission: 'reports', size: 'lg' },
    { id: 'yearly_profit_loss', label: 'Profit/Loss This Year', description: 'Year-to-date income, COGS, expenditure, and profit compared with last year', permission: 'reports', size: 'lg' },
    { id: 'customer_sales', label: 'Customer Sales', description: 'Top customers ranked by monthly sales with their share of total sales', permission: 'reports', size: 'lg' },
    { id: 'products_to_reorder', label: 'Products to Reorder', description: 'Products below minimum stock, grouped by stock percentage', permission: 'inv_items', size: 'sm' },
    { id: 'cash_on_hand',      label: 'Cash on Hand',             description: 'Total balance across all bank accounts', permission: 'banking',     size: 'sm' },
    { id: 'overdue_invoices',  label: 'Overdue Invoices',         description: 'Total overdue AR amount',                permission: 'ar_invoices', size: 'sm' },
    { id: 'net_cash_flow',     label: 'Net Cash Flow (YTD)',      description: 'Year-to-date net cash flow',             permission: 'banking',     size: 'sm' },
    { id: 'outstanding_bills', label: 'Outstanding Bills',        description: 'Total unpaid AP bills',                  permission: 'ap_bills',    size: 'sm' },
    { id: 'recent_invoices',   label: 'Recent Invoices',          description: 'Last 5 AR invoices by date',             permission: 'ar_invoices', size: 'lg' },
    { id: 'recent_payments',   label: 'Recent Payments Received', description: 'Last 5 AR payments received',            permission: 'ar_payments', size: 'lg' },
    { id: 'recent_bills',      label: 'Recent Bills',             description: 'Last 5 AP bills by date',                permission: 'ap_bills',    size: 'lg' },
    { id: 'pending_approvals', label: 'Pending Approvals',        description: 'Documents awaiting your approval',       permission: 'dashboard',   size: 'lg', requiresApproveRight: true },
    { id: 'top_selling_products', label: 'Best Selling Products', description: 'Top 20 products by units sold, per quarter', permission: 'reports', size: 'lg' },
];

export const DEFAULT_WIDGET_IDS: string[] = [
    'monthly_sales', 'yearly_profit_loss', 'customer_sales',
    'cash_on_hand', 'overdue_invoices', 'net_cash_flow', 'products_to_reorder', 'recent_invoices', 'pending_approvals',
];

/** Widgets added after users could save layouts, keyed by the settings-store version that introduced them. */
const INTRODUCED_WIDGETS: Array<{ version: number; ids: string[] }> = [
    { version: 10, ids: ['monthly_sales', 'yearly_profit_loss', 'customer_sales'] },
];

/**
 * Put newly introduced widgets at the top of layouts saved before them. Runs
 * once per stored version, so a widget the user later removes stays removed.
 */
export function addIntroducedWidgets(config: Record<string, string[]>, fromVersion: number): Record<string, string[]> {
    const added = INTRODUCED_WIDGETS.filter(w => w.version > fromVersion).flatMap(w => w.ids);
    if (added.length === 0) return config;
    return Object.fromEntries(Object.entries(config).map(([userId, ids]) =>
        [userId, [...added.filter(id => !ids.includes(id)), ...ids]]));
}
