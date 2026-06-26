// src/stores/workspace/restore.ts
import type { WorkspaceTab } from './types';

export type RestoreAction =
    | { tabId: string; action: 'refetch'; recordId: string }
    | { tabId: string; action: 'reopen-draft' };

/**
 * Decide what to do with each persisted tab on reload.
 * Invariant: this only ever refetches saved records or reopens drafts as forms.
 * It NEVER posts/commits — a recovered draft must require an explicit save.
 */
export function planRestore(tabs: WorkspaceTab[]): RestoreAction[] {
    return tabs.map((t) => {
        const hasDraft = t.draft !== undefined && t.draft !== null;
        if (hasDraft || t.target.recordId === null) {
            return { tabId: t.id, action: 'reopen-draft' };
        }
        return { tabId: t.id, action: 'refetch', recordId: t.target.recordId };
    });
}
