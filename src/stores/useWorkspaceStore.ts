import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceState, WorkspaceTab, TabStatus } from './workspace/types';
import { isAtCap } from './workspace/reducers';
import * as R from './workspace/reducers';

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
            getTab: (id) => get().tabs.find((t) => t.id === id),
        }),
        { name: 'msm-workspace', version: 1 },
    ),
);
