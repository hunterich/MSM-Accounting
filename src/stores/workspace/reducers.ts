import { TAB_CAP, type WorkspaceState, type WorkspaceTab, type TabStatus } from './types';

export function isAtCap(state: WorkspaceState): boolean {
    return state.tabs.length >= TAB_CAP;
}

export function activateTab(state: WorkspaceState, id: string): WorkspaceState {
    if (!state.tabs.some((t) => t.id === id)) return state;
    return { ...state, activeTabId: id };
}

export function openTab(state: WorkspaceState, tab: WorkspaceTab): WorkspaceState {
    const existing = state.tabs.find((t) => t.id === tab.id);
    if (existing) return { ...state, activeTabId: existing.id };
    if (isAtCap(state)) return state; // over cap: drop (store layer surfaces a prompt)
    return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

export function closeTab(state: WorkspaceState, id: string): WorkspaceState {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return state;
    const tabs = state.tabs.filter((t) => t.id !== id);
    let activeTabId = state.activeTabId;
    if (state.activeTabId === id) {
        if (tabs.length === 0) activeTabId = null;
        else activeTabId = (tabs[Math.max(0, idx - 1)] ?? tabs[0]).id;
    }
    return { tabs, activeTabId };
}

export function closeOthers(state: WorkspaceState, id: string): WorkspaceState {
    const keep = state.tabs.find((t) => t.id === id);
    if (!keep) return state;
    return { tabs: [keep], activeTabId: keep.id };
}

export function closeAll(_state?: WorkspaceState): WorkspaceState {
    return { tabs: [], activeTabId: null };
}

function mapTab(state: WorkspaceState, id: string, fn: (t: WorkspaceTab) => WorkspaceTab): WorkspaceState {
    return { ...state, tabs: state.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

export function setStatus(state: WorkspaceState, id: string, status: TabStatus): WorkspaceState {
    return mapTab(state, id, (t) => ({ ...t, status }));
}

export function saveDraft(state: WorkspaceState, id: string, draft: unknown): WorkspaceState {
    return mapTab(state, id, (t) => ({
        ...t,
        draft,
        status: t.status === 'new' ? 'new' : 'dirty',
    }));
}

export function clearDraft(state: WorkspaceState, id: string): WorkspaceState {
    return mapTab(state, id, (t) => {
        const next = { ...t, status: 'clean' as TabStatus };
        delete next.draft;
        return next;
    });
}

export function reorderTab(state: WorkspaceState, id: string, toIndex: number): WorkspaceState {
    const from = state.tabs.findIndex((t) => t.id === id);
    if (from === -1) return state;
    const tabs = [...state.tabs];
    const [moved] = tabs.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, tabs.length));
    tabs.splice(clamped, 0, moved);
    return { ...state, tabs };
}
