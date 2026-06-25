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
    /**
     * Force a unique tab id so repeated calls open SEPARATE tabs instead of
     * focusing an existing one. Used for new/blank documents — you can have
     * several unsaved "New sales order" drafts open at once.
     */
    unique?: boolean;
}

let uniqueSeq = 0;

export function useWorkspaceNav() {
    const openTab = useWorkspaceStore((s) => s.openTab);

    const open = useCallback((args: OpenArgs): boolean => {
        const baseId = makeTabId(args.target);
        const id = args.unique ? `${baseId}#${Date.now().toString(36)}-${uniqueSeq++}` : baseId;
        const tab: WorkspaceTab = {
            id,
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
