import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceState, WorkspaceTab, TabStatus } from './workspace/types';
import { isAtCap } from './workspace/reducers';
import * as R from './workspace/reducers';

/**
 * Single shared tab id for not-yet-migrated modules. Everything outside the
 * workspace-native modules (AR sales-orders/invoices) renders through the
 * router's <Outlet/> in ONE reused "page" tab whose path/title track the
 * current route — so non-migrated modules stay usable without per-page tabs.
 */
export const PAGE_TAB_ID = 'page:route:view:current';

interface WorkspaceStore extends WorkspaceState {
    /** Opens (or focuses) a tab. Returns false if it was dropped for hitting the cap. */
    openTab: (tab: WorkspaceTab) => boolean;
    activateTab: (id: string) => void;
    closeTab: (id: string) => void;
    closeOthers: (id: string) => void;
    closeAll: () => void;
    reorderTab: (id: string, toIndex: number) => void;
    setStatus: (id: string, status: TabStatus) => void;
    saveDraft: (id: string, draft: unknown) => void;
    clearDraft: (id: string) => void;
    /** Upsert + activate the single shared "page" tab for a non-migrated route. */
    setPageTab: (path: string, title: string) => void;
    getTab: (id: string) => WorkspaceTab | undefined;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
    persist(
        (set, get) => ({
            tabs: [],
            activeTabId: null,

            openTab: (tab) => {
                const state = get();
                const alreadyOpen = state.tabs.some((t) => t.id === tab.id);
                if (!alreadyOpen && isAtCap(state)) return false;
                set(R.openTab(state, tab));
                return true;
            },
            activateTab: (id) => set(R.activateTab(get(), id)),
            closeTab: (id) => set(R.closeTab(get(), id)),
            closeOthers: (id) => set(R.closeOthers(get(), id)),
            closeAll: () => set(R.closeAll()),
            reorderTab: (id, toIndex) => set(R.reorderTab(get(), id, toIndex)),
            setStatus: (id, status) => set(R.setStatus(get(), id, status)),
            saveDraft: (id, draft) => set(R.saveDraft(get(), id, draft)),
            clearDraft: (id) => set(R.clearDraft(get(), id)),
            setPageTab: (path, title) => set((state) => {
                const pageTab: WorkspaceTab = {
                    id: PAGE_TAB_ID,
                    kind: 'list',
                    title,
                    target: { module: 'page', entity: 'route', recordId: 'current', mode: 'view' },
                    path,
                    status: 'clean',
                };
                const exists = state.tabs.some((t) => t.id === PAGE_TAB_ID);
                const tabs = exists
                    ? state.tabs.map((t) => (t.id === PAGE_TAB_ID ? pageTab : t))
                    : [...state.tabs, pageTab];
                return { tabs, activeTabId: PAGE_TAB_ID };
            }),
            getTab: (id) => get().tabs.find((t) => t.id === id),
        }),
        { name: 'msm-workspace', version: 1 },
    ),
);
