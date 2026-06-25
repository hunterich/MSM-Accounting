// src/hooks/useWorkspaceNav.ts
import { useCallback } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { makeTabId, type TabTarget, type TabKind, type WorkspaceTab } from '../stores/workspace/types';

interface OpenArgs {
    kind: TabKind;
    target: TabTarget;
    title: string;
    path: string;
    initialStatus?: WorkspaceTab['status'];
}

export function useWorkspaceNav() {
    const openTab = useWorkspaceStore((s) => s.openTab);

    const open = useCallback((args: OpenArgs): boolean => {
        const tab: WorkspaceTab = {
            id: makeTabId(args.target),
            kind: args.kind,
            title: args.title,
            target: args.target,
            path: args.path,
            status: args.initialStatus ?? (args.target.recordId === null ? 'new' : 'clean'),
        };
        const ok = openTab(tab);
        if (!ok) window.alert('You have 10 tabs open. Close one before opening another.');
        return ok;
    }, [openTab]);

    return { open };
}
