// src/components/workspace/WorkspaceShell.tsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TwoLevelTabBar from './TwoLevelTabBar';
import TabContentHost from './TabContentHost';
import TabCapPrompt from './TabCapPrompt';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { pageModuleForPath } from '../../stores/workspace/modules';

const WorkspaceShell = (): React.ReactElement => {
    const navigate = useNavigate();
    const location = useLocation();
    const { open } = useWorkspaceNav();
    const setPageModuleTab = useWorkspaceStore((s) => s.setPageModuleTab);
    const reopenClosed = useWorkspaceStore((s) => s.reopenClosed);
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const activePath = tabs.find((t) => t.id === activeTabId)?.path;

    // Ctrl/Cmd+Shift+T reopens the most-recently-closed tab (browser-style).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
                e.preventDefault();
                reopenClosed();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [reopenClosed]);

    useEffect(() => {
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = useWorkspaceStore.getState();
            return useWorkspaceStore.subscribe((s) => {
                (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = s;
            });
        }
    }, []);

    // Map every navigation to a tab. AR sales-orders/invoices are document
    // modules (multi-tab); `/new` is ignored (new docs come from the "New"
    // button or store restore). Everything else lands in its page module tab.
    useEffect(() => {
        const path = location.pathname;
        const params = new URLSearchParams(location.search);

        if (path.startsWith('/ar/sales-orders')) {
            if (path.startsWith('/ar/sales-orders/new')) return;
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

        if (path.startsWith('/ar/customers')) {
            if (path.startsWith('/ar/customers/new')) return;
            const id = params.get('id');
            if (path.startsWith('/ar/customers/edit') && id) {
                open({ kind: 'doc-form', target: { module: 'ar', entity: 'customer', recordId: id, mode: 'edit' }, title: `Edit ${id}`, path: `/ar/customers/edit?id=${id}&mode=edit` });
            } else if (id) {
                open({ kind: 'doc-view', target: { module: 'ar', entity: 'customer', recordId: id, mode: 'view' }, title: id, path: `/ar/customers?id=${id}` });
            } else {
                open({ kind: 'list', target: { module: 'ar', entity: 'customer', recordId: 'catalog', mode: 'view' }, title: 'Customers', path: '/ar/customers' });
            }
            return;
        }

        if (path.startsWith('/ar/payments')) {
            if (path.startsWith('/ar/payments/new')) return;
            const id = params.get('paymentId');
            if (path.startsWith('/ar/payments/edit') && id) {
                open({ kind: 'doc-form', target: { module: 'ar', entity: 'payment', recordId: id, mode: 'edit' }, title: `Edit ${id}`, path: `/ar/payments/edit?paymentId=${id}` });
            } else if (id) {
                open({ kind: 'doc-view', target: { module: 'ar', entity: 'payment', recordId: id, mode: 'view' }, title: id, path: `/ar/payments?paymentId=${id}` });
            } else {
                open({ kind: 'list', target: { module: 'ar', entity: 'payment', recordId: 'catalog', mode: 'view' }, title: 'Payments (AR)', path: '/ar/payments' });
            }
            return;
        }

        if (path.startsWith('/inventory/counts')) {
            if (path.startsWith('/inventory/counts/new')) return;
            const id = params.get('id') || params.get('countId');
            if (path.startsWith('/inventory/counts/edit') && id) {
                open({ kind: 'doc-form', target: { module: 'stock-count', entity: 'count', recordId: id, mode: 'edit' }, title: `Worksheet ${id}`, path: `/inventory/counts/edit?id=${id}` });
            } else if (id) {
                open({ kind: 'doc-view', target: { module: 'stock-count', entity: 'count', recordId: id, mode: 'view' }, title: id, path: `/inventory/counts?countId=${id}` });
            } else {
                open({ kind: 'list', target: { module: 'stock-count', entity: 'count', recordId: 'catalog', mode: 'view' }, title: 'Stock counts', path: '/inventory/counts' });
            }
            return;
        }

        const pm = pageModuleForPath(path);
        setPageModuleTab(pm.key, pm.title, path + location.search);
    }, [location.pathname, location.search, open, setPageModuleTab]);

    useEffect(() => {
        if (activePath && activePath !== window.location.pathname + window.location.search) {
            navigate(activePath, { replace: true });
        }
    }, [activePath, navigate]);

    return (
        <div className="flex flex-col h-full">
            <TwoLevelTabBar />
            <div className="flex-1 min-h-0">
                <TabContentHost />
            </div>
            <TabCapPrompt />
        </div>
    );
};

export default WorkspaceShell;
