export type TabKind = 'doc-form' | 'doc-view' | 'list' | 'report';

export interface TabTarget {
    module: string;                 // e.g. 'ar'
    entity: string;                 // e.g. 'sales-order' | 'invoice'
    recordId: string | null;        // null => a new/unsaved document
    mode?: 'create' | 'edit' | 'view';
}

export type TabStatus = 'clean' | 'dirty' | 'new';

export interface WorkspaceTab {
    id: string;                     // stable id derived from target (see makeTabId)
    kind: TabKind;
    title: string;                  // e.g. 'SO-1042 · Acme' or 'New sales order'
    icon?: string;                  // optional lucide icon name (kept as a string token)
    target: TabTarget;
    path: string;                   // canonical URL path for deep-link / URL sync
    status: TabStatus;
    draft?: unknown;                // serialized form snapshot for doc-form tabs
}

export interface WorkspaceState {
    tabs: WorkspaceTab[];
    activeTabId: string | null;
}

/** Max simultaneously open tabs. Opening past this is a no-op the store surfaces. */
export const TAB_CAP = 10;

/**
 * Deterministic tab id so re-opening the same record focuses the existing tab.
 * A new document collapses to one tab per entity (`…:create:new`) so clicking
 * "New" twice focuses the same in-progress draft instead of spawning duplicates.
 */
export function makeTabId(t: TabTarget): string {
    const mode = t.mode ?? 'view';
    return `${t.module}:${t.entity}:${mode}:${t.recordId ?? 'new'}`;
}
