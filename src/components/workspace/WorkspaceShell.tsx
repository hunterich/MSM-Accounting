// src/components/workspace/WorkspaceShell.tsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import WorkspaceTabBar from './WorkspaceTabBar';
import TabContentHost from './TabContentHost';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';

const WorkspaceShell = (): React.ReactElement => {
    const navigate = useNavigate();
    const location = useLocation();
    const { open } = useWorkspaceNav();
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
        const soId = new URLSearchParams(location.search).get('soId');

        if (path.startsWith('/ar/sales-orders/new')) {
            return;
        }
        if (path.startsWith('/ar/sales-orders/edit') && soId) {
            open({ kind: 'doc-form', target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' }, title: `Edit ${soId}`, path: `/ar/sales-orders/edit?soId=${soId}` });
        } else if (path.startsWith('/ar/sales-orders') && soId) {
            open({ kind: 'doc-view', target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'view' }, title: soId, path: `/ar/sales-orders?soId=${soId}` });
        } else if (path.startsWith('/ar/sales-orders')) {
            open({ kind: 'list', target: { module: 'ar', entity: 'sales-order', recordId: 'catalog', mode: 'view' }, title: 'Sales Orders', path: '/ar/sales-orders' });
        }
        // other modules: handled as they are migrated in later phases.
    }, [location.pathname, location.search, open]);

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
