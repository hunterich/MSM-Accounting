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

    // Bootstrap a tab from the URL when nothing is active (deep link / fresh load).
    useEffect(() => {
        if (activeTabId) return;
        const path = location.pathname;
        if (path.startsWith('/ar/sales-orders/new')) {
            open({ kind: 'doc-form', target: { module: 'ar', entity: 'sales-order', recordId: null, mode: 'create' }, title: 'New sales order', path: '/ar/sales-orders/new' });
        } else if (path.startsWith('/ar/sales-orders')) {
            open({ kind: 'list', target: { module: 'ar', entity: 'sales-order', recordId: 'catalog', mode: 'view' }, title: 'Sales Orders', path: '/ar/sales-orders' });
        }
        // other modules: handled as they are migrated in later phases.
    }, [activeTabId, location.pathname, open]);

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
