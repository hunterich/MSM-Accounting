// src/components/workspace/WorkspaceShell.tsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import WorkspaceTabBar from './WorkspaceTabBar';
import TabContentHost from './TabContentHost';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';

// Friendly titles for the single shared "page" tab (non-migrated modules).
// Longest-prefix match; falls back to a title-cased last path segment.
const PAGE_TITLES: Array<[string, string]> = [
    ['/banking', 'Banking'],
    ['/reports', 'Reports'],
    ['/settings', 'Settings'],
    ['/company-setup', 'Company setup'],
    ['/integrations', 'Integrations'],
    ['/inventory', 'Inventory'],
    ['/ap/bills', 'Bills'],
    ['/ap/pos', 'Purchase orders'],
    ['/ap/receiving', 'Receive goods'],
    ['/ap/payments', 'Payments (AP)'],
    ['/ap/vendors', 'Vendors'],
    ['/ap', 'Purchases'],
    ['/ar/customers', 'Customers'],
    ['/ar/payments', 'Payments (AR)'],
    ['/ar/credits', 'Credit notes'],
    ['/ar/delivery-notes', 'Delivery notes'],
    ['/ar', 'Sales'],
    ['/hr', 'HR & payroll'],
    ['/assets', 'Assets'],
    ['/gl', 'General ledger'],
];

const titleForPath = (path: string): string => {
    if (path === '/') return 'Dashboard';
    const hit = PAGE_TITLES.find(([prefix]) => path.startsWith(prefix));
    if (hit) return hit[1];
    const seg = path.split('/').filter(Boolean).pop() || 'Page';
    return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
};

const WorkspaceShell = (): React.ReactElement => {
    const navigate = useNavigate();
    const location = useLocation();
    const { open } = useWorkspaceNav();
    const setPageTab = useWorkspaceStore((s) => s.setPageTab);
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const activePath = tabs.find((t) => t.id === activeTabId)?.path;

    useEffect(() => {
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = useWorkspaceStore.getState();
            return useWorkspaceStore.subscribe((s) => {
                (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = s;
            });
        }
    }, []);

    // Open or focus the tab matching the current URL on every navigation
    // (sidebar clicks, deep links, in-app links). New/blank docs are NOT opened
    // from the URL — they come from the "New" button (unique tabs) or are
    // restored from the persisted store — so we ignore `/new` here to avoid
    // spawning a fresh draft on every reload.
    useEffect(() => {
        const path = location.pathname;
        const params = new URLSearchParams(location.search);

        // AR — Sales Orders (workspace-native, multi-tab)
        if (path.startsWith('/ar/sales-orders')) {
            if (path.startsWith('/ar/sales-orders/new')) return; // new from button / restore
            const soId = params.get('soId');
            if (path.startsWith('/ar/sales-orders/edit') && soId) {
                open({ kind: 'doc-form', target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' }, title: `Edit ${soId}`, path: `/ar/sales-orders/edit?soId=${soId}` });
            } else if (soId) {
                open({ kind: 'doc-view', target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'view' }, title: soId, path: `/ar/sales-orders?soId=${soId}` });
            } else {
                open({ kind: 'list', target: { module: 'ar', entity: 'sales-order', recordId: 'catalog', mode: 'view' }, title: 'Sales Orders', path: '/ar/sales-orders' });
            }
            return;
        }

        // AR — Invoices (workspace-native, multi-tab)
        if (path.startsWith('/ar/invoices')) {
            if (path.startsWith('/ar/invoices/new')) return;
            const invoiceId = params.get('invoiceId');
            if (path.startsWith('/ar/invoices/edit') && invoiceId) {
                open({ kind: 'doc-form', target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'edit' }, title: `Edit ${invoiceId}`, path: `/ar/invoices/edit?invoiceId=${invoiceId}` });
            } else if (invoiceId) {
                open({ kind: 'doc-view', target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'view' }, title: invoiceId, path: `/ar/invoices?invoiceId=${invoiceId}` });
            } else {
                open({ kind: 'list', target: { module: 'ar', entity: 'invoice', recordId: 'catalog', mode: 'view' }, title: 'Invoices', path: '/ar/invoices' });
            }
            return;
        }

        // Everything else (not yet migrated): one shared "page" tab rendering
        // the matched route through <Outlet/>.
        setPageTab(path + location.search, titleForPath(path));
    }, [location.pathname, location.search, open, setPageTab]);

    useEffect(() => {
        if (activePath && activePath !== window.location.pathname + window.location.search) {
            navigate(activePath, { replace: true });
        }
    }, [activePath, navigate]);

    return (
        <div className="flex flex-col h-full">
            <WorkspaceTabBar />
            <div className="flex-1 min-h-0">
                <TabContentHost />
            </div>
        </div>
    );
};

export default WorkspaceShell;
