// src/components/workspace/WorkspaceShell.tsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkspaceTabBar from './WorkspaceTabBar';
import TabContentHost from './TabContentHost';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

const WorkspaceShell = (): React.ReactElement => {
    const navigate = useNavigate();
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const tabs = useWorkspaceStore((s) => s.tabs);

    const activePath = tabs.find((t) => t.id === activeTabId)?.path;

    useEffect(() => {
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = useWorkspaceStore.getState();
            return useWorkspaceStore.subscribe((s) => {
                (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = s;
            });
        }
    }, []);

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
