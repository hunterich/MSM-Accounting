import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { orgScopedStorage } from '../lib/orgScopedStorage';
import type { WorkspaceTab, TabStatus } from './workspace/types';
import { moduleKeyOf } from './workspace/modules';
import { capBlock, pushClosed } from './workspace/reducers';
import * as R from './workspace/reducers';

/** How many recently-closed tabs we remember for "reopen closed". */
const CLOSED_STACK_MAX = 10;
/** Only real document tabs are worth reopening (not catalogs / page shells). */
const isReopenable = (t: WorkspaceTab) => t.kind === 'doc-form' || t.kind === 'doc-view';
const removedTabs = (before: WorkspaceTab[], after: WorkspaceTab[]) =>
    before.filter((t) => !after.some((n) => n.id === t.id));

/**
 * Two-level workspace store: a flat `tabs` array tagged by module (via
 * `moduleKeyOf`). The UI renders row 1 = distinct modules, row 2 = the active
 * module's document tabs. `moduleActive` remembers the last-focused document
 * per module so switching modules restores where you were.
 */
interface WorkspaceStore {
    tabs: WorkspaceTab[];
    activeTabId: string | null;
    moduleActive: Record<string, string>;
    /** Recently-closed document tabs (most-recent last) for "reopen closed". */
    closedStack: WorkspaceTab[];
    /** A tab blocked by the cap, awaiting the user's "close one to make room" choice. */
    capPrompt: WorkspaceTab | null;

    /** Opens (or focuses) a tab. Returns false if dropped for hitting the cap. */
    openTab: (tab: WorkspaceTab) => boolean;
    activateTab: (id: string) => void;
    /** Switch to a module (row-1 click): focus its remembered/first document. */
    activateModule: (moduleKey: string) => void;
    closeTab: (id: string) => void;
    /** Close a whole module (row-1 close): drops all its document tabs. */
    closeModule: (moduleKey: string) => void;
    closeOthers: (id: string) => void;
    /** Close every tab to the right of the given one within its row. */
    closeToRight: (id: string) => void;
    closeAll: () => void;
    /** Reopen the most-recently-closed document tab. Returns false if none / at cap. */
    reopenClosed: () => boolean;
    /** Stash a tab the cap blocked so the UI can offer to make room. */
    promptForCap: (tab: WorkspaceTab) => void;
    /** Close `closeId` to free a doc slot in its module, then open the stashed tab. */
    resolveCapPrompt: (closeId: string) => void;
    /** Close a whole module to free a module slot, then open the stashed tab. */
    resolveCapPromptByModule: (moduleKey: string) => void;
    /** Dismiss the cap prompt, leaving tabs untouched. */
    dismissCapPrompt: () => void;
    reorderTab: (id: string, toIndex: number) => void;
    setStatus: (id: string, status: TabStatus) => void;
    saveDraft: (id: string, draft: unknown) => void;
    clearDraft: (id: string) => void;
    /** Upsert + activate the single tab for a page module (non-migrated area). */
    setPageModuleTab: (moduleKey: string, title: string, path: string) => void;
    getTab: (id: string) => WorkspaceTab | undefined;
}

const moduleKeyOfId = (tabs: WorkspaceTab[], id: string | null): string | null => {
    const t = tabs.find((x) => x.id === id);
    return t ? moduleKeyOf(t.target) : null;
};

export const useWorkspaceStore = create<WorkspaceStore>()(
    persist(
        (set, get) => ({
            tabs: [],
            activeTabId: null,
            moduleActive: {},
            closedStack: [],
            capPrompt: null,

            openTab: (tab) => {
                const state = get();
                const already = state.tabs.some((t) => t.id === tab.id);
                if (!already && capBlock(state, tab)) return false;
                const next = R.openTab(state, tab);
                set({
                    ...next,
                    moduleActive: { ...state.moduleActive, [moduleKeyOf(tab.target)]: tab.id },
                });
                return true;
            },

            activateTab: (id) => {
                const state = get();
                const next = R.activateTab(state, id);
                const mk = moduleKeyOfId(state.tabs, id);
                set({ ...next, moduleActive: mk ? { ...state.moduleActive, [mk]: id } : state.moduleActive });
            },

            activateModule: (moduleKey) => {
                const state = get();
                const remembered = state.moduleActive[moduleKey];
                const target = remembered && state.tabs.some((t) => t.id === remembered)
                    ? remembered
                    : state.tabs.find((t) => moduleKeyOf(t.target) === moduleKey)?.id ?? null;
                if (!target) return;
                set({ activeTabId: target, moduleActive: { ...state.moduleActive, [moduleKey]: target } });
            },

            closeTab: (id) => {
                const state = get();
                const next = R.closeTab(state, id);
                const moduleActive = { ...state.moduleActive };
                for (const k of Object.keys(moduleActive)) if (moduleActive[k] === id) delete moduleActive[k];
                if (next.activeTabId) {
                    const mk = moduleKeyOfId(next.tabs, next.activeTabId);
                    if (mk) moduleActive[mk] = next.activeTabId;
                }
                const closedStack = pushClosed(state.closedStack, removedTabs(state.tabs, next.tabs).filter(isReopenable), CLOSED_STACK_MAX);
                set({ ...next, moduleActive, closedStack });
            },

            closeModule: (moduleKey) => {
                const state = get();
                const tabs = state.tabs.filter((t) => moduleKeyOf(t.target) !== moduleKey);
                const moduleActive = { ...state.moduleActive };
                delete moduleActive[moduleKey];
                let activeTabId = state.activeTabId;
                const activeKey = moduleKeyOfId(state.tabs, state.activeTabId);
                if (activeKey === moduleKey || !tabs.some((t) => t.id === activeTabId)) {
                    activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
                }
                const closedStack = pushClosed(state.closedStack, removedTabs(state.tabs, tabs).filter(isReopenable), CLOSED_STACK_MAX);
                set({ tabs, activeTabId, moduleActive, closedStack });
            },

            closeOthers: (id) => {
                const state = get();
                const next = R.closeOthers(state, id);
                const closedStack = pushClosed(state.closedStack, removedTabs(state.tabs, next.tabs).filter(isReopenable), CLOSED_STACK_MAX);
                set({ ...next, closedStack });
            },

            closeToRight: (id) => {
                const state = get();
                const next = R.closeToRight(state, id);
                const closedStack = pushClosed(state.closedStack, removedTabs(state.tabs, next.tabs).filter(isReopenable), CLOSED_STACK_MAX);
                set({ ...next, closedStack });
            },

            closeAll: () => {
                const state = get();
                const closedStack = pushClosed(state.closedStack, state.tabs.filter(isReopenable), CLOSED_STACK_MAX);
                set({ ...R.closeAll(), moduleActive: {}, closedStack });
            },

            reopenClosed: () => {
                const { closedStack } = get();
                if (closedStack.length === 0) return false;
                const tab = closedStack[closedStack.length - 1];
                const opened = get().openTab(tab); // false if at cap; leaves the stack intact
                if (!opened) return false;
                set({ closedStack: closedStack.slice(0, -1) });
                return true;
            },

            promptForCap: (tab) => set({ capPrompt: tab }),
            dismissCapPrompt: () => set({ capPrompt: null }),
            resolveCapPrompt: (closeId) => {
                const pending = get().capPrompt;
                get().closeTab(closeId); // frees a doc slot (and records the victim as reopenable)
                if (pending) get().openTab(pending);
                set({ capPrompt: null });
            },
            resolveCapPromptByModule: (moduleKey) => {
                const pending = get().capPrompt;
                get().closeModule(moduleKey); // frees a module slot
                if (pending) get().openTab(pending);
                set({ capPrompt: null });
            },

            reorderTab: (id, toIndex) => set(R.reorderTab(get(), id, toIndex)),
            setStatus: (id, status) => set(R.setStatus(get(), id, status)),
            saveDraft: (id, draft) => set(R.saveDraft(get(), id, draft)),
            clearDraft: (id) => set(R.clearDraft(get(), id)),

            setPageModuleTab: (moduleKey, title, path) => set((state) => {
                const id = `page:${moduleKey}`;
                const pageTab: WorkspaceTab = {
                    id,
                    kind: 'list',
                    title,
                    target: { module: 'page', entity: 'route', recordId: moduleKey, mode: 'view' },
                    path,
                    status: 'clean',
                };
                const exists = state.tabs.some((t) => t.id === id);
                const tabs = exists ? state.tabs.map((t) => (t.id === id ? pageTab : t)) : [...state.tabs, pageTab];
                return { tabs, activeTabId: id, moduleActive: { ...state.moduleActive, [`page:${moduleKey}`]: id } };
            }),

            getTab: (id) => get().tabs.find((t) => t.id === id),
        }),
        {
            name: 'msm-workspace',
            version: 2,
            // Partitioned per company: keys become `msm-workspace:<orgId>`
            // (`:default` before an org is chosen), so two tabs on different
            // companies stop sharing workspace state through localStorage.
            storage: createJSONStorage(() => orgScopedStorage),
            // The shape changed from the flat single-row model — start fresh.
            migrate: () => ({ tabs: [], activeTabId: null, moduleActive: {}, closedStack: [] }),
            // capPrompt is transient UI state — never persist a half-open prompt.
            partialize: (s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, moduleActive: s.moduleActive, closedStack: s.closedStack }),
        },
    ),
);
