// src/components/workspace/TabContentHost.tsx
import React, { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary, PageErrorFallback } from '../UI/ErrorBoundary';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { renderTab, tabViewPermission } from './tabRegistry';
import { useAuthStore } from '../../stores/useAuthStore';
import { isTablessPath } from '../../stores/workspace/modules';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { translate } from '../../i18n/language';

const TabContentHost = (): React.ReactElement => {
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const hasPermission = useAuthStore((s) => s.hasPermission);
    const language = useLanguageStore((s) => s.language) ?? 'en';
    const location = useLocation();
    // Restored tabs load on first focus. Once visited, forms stay mounted so
    // switching tabs preserves their local state and unsaved edits.
    const [visited, setVisited] = useState(() => new Set(activeTabId ? [activeTabId] : []));
    useEffect(() => {
        setVisited((previous) => {
            const next = new Set(tabs.filter((tab) => tab.id === activeTabId || previous.has(tab.id)).map((tab) => tab.id));
            return next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
        });
    }, [tabs, activeTabId]);
    // /403 and the redirect-only area paths have no tab: render the router's
    // element over the (still mounted, hidden) tabs so nothing is lost.
    const tabless = isTablessPath(location.pathname);
    const tablessOutlet = tabless ? (
        <div key="__tabless" className="h-full min-h-0 overflow-y-auto">
            <ErrorBoundary fallback={PageErrorFallback}><Outlet /></ErrorBoundary>
        </div>
    ) : null;

    if (tabs.length === 0) {
        if (tablessOutlet) return tablessOutlet;
        return (
            <div className="p-10 text-center text-sm text-neutral-500">
                {translate(language, 'No open tabs. Pick something from the sidebar to get started.')}
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
                    return isActive && !tabless ? (
                        <div key={tab.id} className="h-full min-h-0 overflow-y-auto">
                            <ErrorBoundary fallback={PageErrorFallback}><Outlet /></ErrorBoundary>
                        </div>
                    ) : null;
                }
                if (!isActive && !visited.has(tab.id)) return null;
                // Workspace-native tabs stay mounted (keep-alive), hidden when inactive.
                // Deny in place rather than redirecting: every document tab stays
                // mounted for keep-alive, so a redirect from a hidden tab would
                // yank the whole app off the tab the user is actually looking at.
                const needs = tabViewPermission(tab);
                const denied = needs !== null && !hasPermission(needs, 'view');
                return (
                    <div key={tab.id} hidden={!isActive || tabless} className="h-full min-h-0 overflow-y-auto">
                        <ErrorBoundary fallback={PageErrorFallback}>
                            {denied ? (
                                <div className="p-10 text-center text-sm text-neutral-600">
                                    {language === 'id' ? `Anda tidak memiliki izin untuk melihat ${translate(language, tab.title)}.` : `You do not have permission to view ${tab.title}.`}
                                </div>
                            ) : (
                                <Suspense fallback={<div role="status" className="p-6 text-sm text-neutral-500">{translate(language, 'Loading...')}</div>}>
                                    {renderTab(tab)}
                                </Suspense>
                            )}
                        </ErrorBoundary>
                    </div>
                );
            })}
            {tablessOutlet}
        </>
    );
};

export default TabContentHost;
