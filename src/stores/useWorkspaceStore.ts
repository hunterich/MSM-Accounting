import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceTab, TabStatus } from './workspace/types';
import { moduleKeyOf } from './workspace/modules';
import { isAtCap } from './workspace/reducers';
import * as R from './workspace/reducers';

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

    /** Opens (or focuses) a tab. Returns false if dropped for hitting the cap. */
    openTab: (tab: WorkspaceTab) => boolean;
    activateTab: (id: string) => void;
    /** Switch to a module (row-1 click): focus its remembered/first document. */
    activateModule: (moduleKey: string) => void;
    closeTab: (id: string) => void;
    /** Close a whole module (row-1 close): drops all its document tabs. */
    closeModule: (moduleKey: string) => void;
    closeOthers: (id: string) => void;
    closeAll: () => void;
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

            openTab: (tab) => {
                const state = get();
                const already = state.tabs.some((t) => t.id === tab.id);
                if (!already && isAtCap(state)) return false;
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
                set({ ...next, moduleActive });
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
                set({ tabs, activeTabId, moduleActive });
            },

            closeOthers: (id) => set({ ...R.closeOthers(get(), id) }),
            closeAll: () => set({ ...R.closeAll(), moduleActive: {} }),
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
            // The shape changed from the flat single-row model — start fresh.
            migrate: () => ({ tabs: [], activeTabId: null, moduleActive: {} }),
        },
    ),
);
