// src/components/workspace/WorkspaceTabBar.tsx
import React from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { TAB_CAP } from '../../stores/workspace/types';

const WorkspaceTabBar = (): React.ReactElement | null => {
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const activate = useWorkspaceStore((s) => s.activateTab);
    const close = useWorkspaceStore((s) => s.closeTab);

    if (tabs.length === 0) return null;

    const handleClose = (id: string, dirty: boolean) => {
        if (dirty && !window.confirm('Discard unsaved changes in this tab?')) return;
        close(id);
    };

    return (
        <div className="workbench-doc-tabs">
            <div className="workbench-doc-tab-row">
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    const dirty = tab.status !== 'clean';
                    return (
                        <button
                            key={tab.id}
                            className={`workbench-doc-tab ${isActive ? 'active' : ''}`}
                            onClick={() => activate(tab.id)}
                            title={tab.title}
                        >
                            {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 mr-1.5 inline-block" />}
                            {tab.title}
                            <span
                                className="workbench-doc-tab-close"
                                onClick={(e) => { e.stopPropagation(); handleClose(tab.id, dirty); }}
                            >
                                <X size={14} />
                            </span>
                        </button>
                    );
                })}
                <div className="workbench-tab-count">Open tabs: {tabs.length}/{TAB_CAP}</div>
            </div>
        </div>
    );
};

export default WorkspaceTabBar;
