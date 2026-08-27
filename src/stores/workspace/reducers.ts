import { TAB_CAP, MODULE_CAP, type WorkspaceState, type WorkspaceTab, type TabStatus } from './types';
import { moduleKeyOf } from './modules';

/** True once the workspace holds TAB_CAP tabs in total (flat). Kept for callers
 *  that want an overall sense of fullness; the open gate is `capBlock`. */
export function isAtCap(state: WorkspaceState): boolean {
    return state.tabs.length >= TAB_CAP;
}

const moduleKeysOf = (state: WorkspaceState) => new Set(state.tabs.map((t) => moduleKeyOf(t.target)));
// The catalog/list tab is navigation, not a document — it doesn't consume a slot
// (otherwise you couldn't reopen the list with TAB_CAP records already open).
const docsInModule = (state: WorkspaceState, key: string) =>
    state.tabs.filter((t) => moduleKeyOf(t.target) === key && t.kind !== 'list').length;

/**
 * Two-level cap gate. Returns why opening `tab` is blocked, or null if allowed:
 *  - 'module' — it would be a NEW module and we're already at MODULE_CAP modules.
 *  - 'doc'    — its module already holds TAB_CAP document tabs (catalog excluded).
 * The two counts are independent (10 modules × 10 docs each).
 */
export function capBlock(state: WorkspaceState, tab: WorkspaceTab): 'module' | 'doc' | null {
    const key = moduleKeyOf(tab.target);
    const moduleExists = state.tabs.some((t) => moduleKeyOf(t.target) === key);
    if (!moduleExists) return moduleKeysOf(state).size >= MODULE_CAP ? 'module' : null;
    if (tab.kind === 'list') return null; // the catalog is always reachable
    return docsInModule(state, key) >= TAB_CAP ? 'doc' : null;
}

/**
 * The dashboard is permanent, the way Accurate keeps its home tab: it carries no
 * close control and every bulk close leaves it standing. Enforced here rather
 * than only hiding the button, so "Close others", "Close to the right" and
 * "Close all" cannot take it either — and so the workspace is never left with
 * zero tabs and an empty shell.
 */
export function isPinnedTab(tab: WorkspaceTab): boolean {
    return tab.target.module === 'page' && tab.target.recordId === 'dashboard';
}

export function activateTab(state: WorkspaceState, id: string): WorkspaceState {
    if (!state.tabs.some((t) => t.id === id)) return state;
    return { ...state, activeTabId: id };
}

export function openTab(state: WorkspaceState, tab: WorkspaceTab): WorkspaceState {
    const existing = state.tabs.find((t) => t.id === tab.id);
    if (existing) return { ...state, activeTabId: existing.id };
    if (capBlock(state, tab)) return state; // over a cap: drop (store layer surfaces a prompt)
    return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

export function closeTab(state: WorkspaceState, id: string): WorkspaceState {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return state;
    if (isPinnedTab(state.tabs[idx])) return state;
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
    const tabs = state.tabs.filter((t) => t.id === id || isPinnedTab(t));
    return { tabs, activeTabId: keep.id };
}

export function closeAll(state?: WorkspaceState): WorkspaceState {
    const tabs = (state?.tabs ?? []).filter(isPinnedTab);
    return { tabs, activeTabId: tabs.length ? tabs[0].id : null };
}

export function closeToRight(state: WorkspaceState, id: string): WorkspaceState {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return state;
    const tabs = state.tabs.filter((t, i) => i <= idx || isPinnedTab(t));
    const activeTabId = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : id;
    return { tabs, activeTabId };
}

/**
 * Push closed tabs onto a most-recently-closed-last stack for "reopen closed".
 * Drops any earlier entry sharing an id (so a re-closed tab reopens unambiguously)
 * and caps the stack to `max`, dropping the oldest entries first.
 */
export function pushClosed(stack: WorkspaceTab[], closed: WorkspaceTab[], max: number): WorkspaceTab[] {
    const closedIds = new Set(closed.map((t) => t.id));
    const next = [...stack.filter((t) => !closedIds.has(t.id)), ...closed];
    return next.length > max ? next.slice(next.length - max) : next;
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
