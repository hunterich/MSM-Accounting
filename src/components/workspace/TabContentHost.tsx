// src/components/workspace/TabContentHost.tsx
import React from 'react';
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
            {tabs.map((tab) => (
                <div key={tab.id} hidden={tab.id !== activeTabId} className="h-full">
                    <ErrorBoundary fallback={PageErrorFallback}>
                        {renderTab(tab)}
                    </ErrorBoundary>
                </div>
            ))}
        </>
    );
};

export default TabContentHost;
