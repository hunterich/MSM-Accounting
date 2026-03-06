export const WIDGET_REGISTRY = [
    { id: 'cash_on_hand',      label: 'Cash on Hand',             description: 'Total balance across all bank accounts', permission: 'banking',     size: 'sm' },
    { id: 'overdue_invoices',  label: 'Overdue Invoices',         description: 'Total overdue AR amount',                permission: 'ar_invoices', size: 'sm' },
    { id: 'net_cash_flow',     label: 'Net Cash Flow (YTD)',      description: 'Year-to-date net cash flow',             permission: 'banking',     size: 'sm' },
    { id: 'outstanding_bills', label: 'Outstanding Bills',        description: 'Total unpaid AP bills',                  permission: 'ap_bills',    size: 'sm' },
    { id: 'recent_invoices',   label: 'Recent Invoices',          description: 'Last 5 AR invoices by date',             permission: 'ar_invoices', size: 'lg' },
    { id: 'recent_payments',   label: 'Recent Payments Received', description: 'Last 5 AR payments received',            permission: 'ar_payments', size: 'lg' },
    { id: 'recent_bills',      label: 'Recent Bills',             description: 'Last 5 AP bills by date',                permission: 'ap_bills',    size: 'lg' },
];

export const DEFAULT_WIDGET_IDS = [
    'cash_on_hand', 'overdue_invoices', 'net_cash_flow', 'recent_invoices',
];
