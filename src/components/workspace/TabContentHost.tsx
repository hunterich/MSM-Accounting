// src/components/workspace/TabContentHost.tsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import { ErrorBoundary, PageErrorFallback } from '../UI/ErrorBoundary';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { renderTab } from './tabRegistry';

const TabContentHost = (): React.ReactElement => {
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);

    if (tabs.length === 0) {
        return (
            <div className="p-10 text-center text-sm text-neutral-500">
                No open tabs. Pick something from the sidebar to get started.
            </div>
        );
    }

    return (
        <>
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                // Not-yet-migrated modules render through the router. They share
                // one <Outlet/>, so only the active page tab renders (no keep-alive).
                if (tab.target.module === 'page') {
                    return isActive ? (
                        <div key={tab.id} className="h-full">
                            <ErrorBoundary fallback={PageErrorFallback}><Outlet /></ErrorBoundary>
                        </div>
                    ) : null;
                }
                // Workspace-native tabs stay mounted (keep-alive), hidden when inactive.
                return (
                    <div key={tab.id} hidden={!isActive} className="h-full">
                        <ErrorBoundary fallback={PageErrorFallback}>
                            {renderTab(tab)}
                        </ErrorBoundary>
                    </div>
                );
            })}
        </>
    );
};

export default TabContentHost;
