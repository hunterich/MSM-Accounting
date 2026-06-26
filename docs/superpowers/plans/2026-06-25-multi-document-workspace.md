# Multi-document workspace (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app an Accurate-style global tabbed workspace so many documents/reports stay open at once and in-progress work survives both tab switches and app reloads, wired first for Sales Orders and Invoices.

**Architecture:** A persisted `useWorkspaceStore` is the single source of truth for open tabs + active tab. A `WorkspaceShell` replaces the Layout's single `<Outlet/>` (behind a feature flag) and renders a global tab bar plus a keep-alive content host that mounts every open tab and only hides the inactive ones — so local form state survives switching. Forms debounce-autosave a draft snapshot into their tab; on reload, saved documents refetch and unsaved drafts reopen as editable forms that never post to the ledger until explicitly saved.

**Tech Stack:** React 19, React Router 7, Zustand 5 (`persist`), Vite 7, Vitest 4 (node env, pure-logic unit tests), Playwright (e2e). `@` resolves to repo root (see `vite.config.ts`).

**Spec:** `docs/superpowers/specs/2026-06-25-multi-document-workspace-design.md`

---

## Conventions for this plan

- Unit tests are **pure-logic** (`describe/it/expect` from `vitest`, no DOM — jsdom/testing-library are not installed). UI behavior is verified with Playwright e2e under `e2e/`.
- Run a single unit test file with: `npx vitest run <path>`.
- Run an e2e spec with: `npx playwright test <path>` (dev servers per `project_dev_servers` memory: frontend 5173, backend 3000).
- Commit after every task. Branch is already the worktree branch `claude/musing-liskov-313c57`.
- The feature ships **off by default** behind `VITE_WORKSPACE_TABS`. Flip it on only in the final task.

## File structure

New files:

- `src/config/featureFlags.ts` — reads `VITE_WORKSPACE_TABS`; exports `WORKSPACE_TABS_ENABLED`.
- `src/stores/workspace/types.ts` — `TabKind`, `TabTarget`, `WorkspaceTab`, `WorkspaceState`, `TAB_CAP`, `makeTabId`.
- `src/stores/workspace/reducers.ts` — pure reducers (`openTab`, `closeTab`, `closeOthers`, `closeAll`, `activateTab`, `reorderTab`, `setStatus`, `saveDraft`, `clearDraft`, `isAtCap`).
- `src/stores/workspace/__tests__/reducers.test.ts` — reducer unit tests.
- `src/stores/workspace/restore.ts` — `planRestore` pure function (refetch vs reopen-draft; never commit).
- `src/stores/workspace/__tests__/restore.test.ts` — restore-planning unit tests (the never-auto-post guard).
- `src/stores/useWorkspaceStore.ts` — Zustand store composing the reducers, persisted.
- `src/utils/debounce.ts` — tiny debounce helper.
- `src/utils/__tests__/debounce.test.ts` — debounce unit tests.
- `src/hooks/useDraftAutosave.ts` — debounced snapshot → `saveDraft`.
- `src/hooks/useWorkspaceNav.ts` — imperative open helpers used by sidebar/lists/forms.
- `src/components/workspace/tabRegistry.tsx` — maps a tab to its React element.
- `src/components/workspace/TabContentHost.tsx` — keep-alive renderer + per-tab error boundary.
- `src/components/workspace/WorkspaceTabBar.tsx` — global tab bar (dirty dots, close, cap).
- `src/components/workspace/WorkspaceShell.tsx` — composes bar + host + URL sync + reload restore.
- `src/components/ar/salesorders/SalesOrderListPane.tsx` — catalog-only list that opens workspace tabs.
- `e2e/workspace.spec.ts` — keep-alive + reload + never-auto-post.

Modified files:

- `src/components/Layout/Layout.tsx` — render `<WorkspaceShell/>` instead of `<Outlet/>` when the flag is on.
- `src/components/ar/salesorders/SOFormV2.tsx` — accept workspace props; save without navigating; autosave draft; push dirty/status to the store.
- `.env.example` (if present) — document `VITE_WORKSPACE_TABS`.

---

## Milestone 1 — Workspace foundation (flag-gated, generic tabs)

### Task 1: Feature flag + workspace types

**Files:**
- Create: `src/config/featureFlags.ts`
- Create: `src/stores/workspace/types.ts`

- [ ] **Step 1: Write the feature flag**

```ts
// src/config/featureFlags.ts
/** Multi-document workspace (Accurate-style tabs). Off unless VITE_WORKSPACE_TABS=1. */
export const WORKSPACE_TABS_ENABLED: boolean =
    import.meta.env.VITE_WORKSPACE_TABS === '1';
```

- [ ] **Step 2: Write the workspace types**

```ts
// src/stores/workspace/types.ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from the new files).

- [ ] **Step 4: Commit**

```bash
git add src/config/featureFlags.ts src/stores/workspace/types.ts
git commit -m "feat(workspace): feature flag + tab types"
```

---

### Task 2: Pure reducers + unit tests (TDD)

**Files:**
- Create: `src/stores/workspace/__tests__/reducers.test.ts`
- Create: `src/stores/workspace/reducers.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/stores/workspace/__tests__/reducers.test.ts
import { describe, it, expect } from 'vitest';
import {
    openTab, closeTab, closeOthers, closeAll,
    activateTab, setStatus, saveDraft, clearDraft, isAtCap,
} from '../reducers';
import { makeTabId, TAB_CAP, type WorkspaceState, type TabTarget } from '../types';

const empty: WorkspaceState = { tabs: [], activeTabId: null };

const tab = (entity: string, recordId: string | null, mode: TabTarget['mode'] = 'view') => {
    const target: TabTarget = { module: 'ar', entity, recordId, mode };
    return {
        id: makeTabId(target),
        kind: 'doc-view' as const,
        title: `${entity}:${recordId ?? 'new'}`,
        target,
        path: `/ar/${entity}/${recordId ?? 'new'}`,
        status: 'clean' as const,
    };
};

describe('openTab', () => {
    it('adds a tab and activates it', () => {
        const s = openTab(empty, tab('sales-order', 'SO-1'));
        expect(s.tabs).toHaveLength(1);
        expect(s.activeTabId).toBe(makeTabId({ module: 'ar', entity: 'sales-order', recordId: 'SO-1', mode: 'view' }));
    });

    it('is idempotent — re-opening an open record activates it without duplicating', () => {
        const s1 = openTab(empty, tab('sales-order', 'SO-1'));
        const s2 = openTab(activateTab(s1, s1.tabs[0].id), tab('invoice', 'INV-1'));
        const s3 = openTab(s2, tab('sales-order', 'SO-1'));
        expect(s3.tabs).toHaveLength(2);
        expect(s3.activeTabId).toBe(s1.tabs[0].id);
    });

    it('does not add past the cap (no-op) but still activates an already-open tab', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < TAB_CAP; i++) s = openTab(s, tab('sales-order', `SO-${i}`));
        expect(s.tabs).toHaveLength(TAB_CAP);
        const overflowed = openTab(s, tab('sales-order', 'SO-OVER'));
        expect(overflowed.tabs).toHaveLength(TAB_CAP);          // dropped
        const reopen = openTab(s, tab('sales-order', 'SO-0'));  // already open
        expect(reopen.activeTabId).toBe(s.tabs[0].id);
    });
});

describe('closeTab', () => {
    it('removes the tab and falls back to the left neighbour when closing the active one', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        s = openTab(s, tab('sales-order', 'C')); // active = C
        const closed = closeTab(s, s.tabs[2].id);
        expect(closed.tabs.map((t) => t.target.recordId)).toEqual(['A', 'B']);
        expect(closed.activeTabId).toBe(closed.tabs[1].id); // B
    });

    it('clears active when the last tab is closed', () => {
        const s = openTab(empty, tab('sales-order', 'A'));
        const closed = closeTab(s, s.tabs[0].id);
        expect(closed.tabs).toHaveLength(0);
        expect(closed.activeTabId).toBeNull();
    });
});

describe('closeOthers / closeAll', () => {
    it('closeOthers keeps only the given tab and activates it', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        s = openTab(s, tab('sales-order', 'C'));
        const only = closeOthers(s, s.tabs[0].id);
        expect(only.tabs.map((t) => t.target.recordId)).toEqual(['A']);
        expect(only.activeTabId).toBe(s.tabs[0].id);
    });

    it('closeAll empties the workspace', () => {
        let s: WorkspaceState = empty;
        s = openTab(s, tab('sales-order', 'A'));
        s = openTab(s, tab('sales-order', 'B'));
        const cleared = closeAll(s);
        expect(cleared).toEqual(empty);
    });
});

describe('status + drafts', () => {
    it('setStatus updates a single tab', () => {
        const s = openTab(empty, tab('sales-order', 'A'));
        const dirty = setStatus(s, s.tabs[0].id, 'dirty');
        expect(dirty.tabs[0].status).toBe('dirty');
    });

    it('saveDraft stores a snapshot and marks the tab dirty (or new for a create tab)', () => {
        const newTab = openTab(empty, { ...tab('sales-order', null, 'create'), kind: 'doc-form', status: 'new' });
        const withDraft = saveDraft(newTab, newTab.tabs[0].id, { customerId: 'C1' });
        expect(withDraft.tabs[0].draft).toEqual({ customerId: 'C1' });
        expect(withDraft.tabs[0].status).toBe('new');
    });

    it('clearDraft removes the snapshot and marks the tab clean', () => {
        const s = saveDraft(openTab(empty, { ...tab('sales-order', 'A'), kind: 'doc-form' }), makeTabId({ module: 'ar', entity: 'sales-order', recordId: 'A', mode: 'view' }), { x: 1 });
        const cleared = clearDraft(s, s.tabs[0].id);
        expect(cleared.tabs[0].draft).toBeUndefined();
        expect(cleared.tabs[0].status).toBe('clean');
    });
});

describe('isAtCap', () => {
    it('is true only when tab count reaches the cap', () => {
        let s: WorkspaceState = empty;
        for (let i = 0; i < TAB_CAP - 1; i++) s = openTab(s, tab('sales-order', `SO-${i}`));
        expect(isAtCap(s)).toBe(false);
        s = openTab(s, tab('sales-order', 'SO-last'));
        expect(isAtCap(s)).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/workspace/__tests__/reducers.test.ts`
Expected: FAIL with "Cannot find module '../reducers'".

- [ ] **Step 3: Write the reducers**

```ts
// src/stores/workspace/reducers.ts
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

export function closeAll(): WorkspaceState {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/workspace/__tests__/reducers.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspace/reducers.ts src/stores/workspace/__tests__/reducers.test.ts
git commit -m "feat(workspace): pure tab reducers with tests"
```

---

### Task 3: Workspace store (Zustand + persist)

**Files:**
- Create: `src/stores/useWorkspaceStore.ts`

- [ ] **Step 1: Write the store**

```ts
// src/stores/useWorkspaceStore.ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/stores/useWorkspaceStore.ts
git commit -m "feat(workspace): persisted zustand store over the reducers"
```

---

### Task 4: Tab registry (with a generic fallback pane)

**Files:**
- Create: `src/components/workspace/tabRegistry.tsx`

- [ ] **Step 1: Write the registry**

The registry maps a tab to an element. In Milestone 1 it renders a generic placeholder; Sales Orders/Invoices are added in later tasks. Keeping a single switch here means the content host stays dumb.

```tsx
// src/components/workspace/tabRegistry.tsx
import React from 'react';
import type { WorkspaceTab } from '../../stores/workspace/types';

/** Renders the body for a tab. Extended per-entity as modules are wired in. */
export function renderTab(tab: WorkspaceTab): React.ReactNode {
    // Milestone 2+ adds entity branches above this fallback.
    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for “{tab.target.module}/{tab.target.entity}” yet.</div>
        </div>
    );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/workspace/tabRegistry.tsx
git commit -m "feat(workspace): tab registry with generic fallback pane"
```

---

### Task 5: Keep-alive content host

**Files:**
- Create: `src/components/workspace/TabContentHost.tsx`

- [ ] **Step 1: Write the host**

Every open tab is mounted; inactive ones are hidden with the `hidden` attribute so their React state, scroll, and focus survive. Each pane gets its own error boundary (reusing the existing one) so a crash is contained to one tab.

```tsx
// src/components/workspace/TabContentHost.tsx
import React from 'react';
import { ErrorBoundary, PageErrorFallback } from '../UI/ErrorBoundary';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { renderTab } from './tabRegistry';

const TabContentHost = (): React.ReactElement => {
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);

    if (tabs.length === 0) {
        return (
            <div className="p-10 text-center text-sm text-neutral-500">
                No open tabs. Pick something from the sidebar to get started.
            </div>
        );
    }

    return (
        <>
            {tabs.map((tab) => (
                <div key={tab.id} hidden={tab.id !== activeTabId} className="h-full">
                    <ErrorBoundary fallback={PageErrorFallback}>
                        {renderTab(tab)}
                    </ErrorBoundary>
                </div>
            ))}
        </>
    );
};

export default TabContentHost;
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/workspace/TabContentHost.tsx
git commit -m "feat(workspace): keep-alive content host with per-tab error boundary"
```

---

### Task 6: Global workspace tab bar

**Files:**
- Create: `src/components/workspace/WorkspaceTabBar.tsx`

- [ ] **Step 1: Write the tab bar**

A dedicated bar (separate from the per-module `DocumentTabBar`) so it can show the unsaved dot and a cap hint. Uses the same `workbench-doc-tab*` CSS classes that already exist.

```tsx
// src/components/workspace/WorkspaceTabBar.tsx
import React from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { TAB_CAP } from '../../stores/workspace/types';

const WorkspaceTabBar = (): React.ReactElement | null => {
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const activate = useWorkspaceStore((s) => s.activateTab);
    const close = useWorkspaceStore((s) => s.closeTab);

    if (tabs.length === 0) return null;

    const handleClose = (id: string, dirty: boolean) => {
        if (dirty && !window.confirm('Discard unsaved changes in this tab?')) return;
        close(id);
    };

    return (
        <div className="workbench-doc-tabs">
            <div className="workbench-doc-tab-row">
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    const dirty = tab.status !== 'clean';
                    return (
                        <button
                            key={tab.id}
                            className={`workbench-doc-tab ${isActive ? 'active' : ''}`}
                            onClick={() => activate(tab.id)}
                            title={tab.title}
                        >
                            {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 mr-1.5 inline-block" />}
                            {tab.title}
                            <span
                                className="workbench-doc-tab-close"
                                onClick={(e) => { e.stopPropagation(); handleClose(tab.id, dirty); }}
                            >
                                <X size={14} />
                            </span>
                        </button>
                    );
                })}
                <div className="workbench-tab-count">Open tabs: {tabs.length}/{TAB_CAP}</div>
            </div>
        </div>
    );
};

export default WorkspaceTabBar;
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/workspace/WorkspaceTabBar.tsx
git commit -m "feat(workspace): global tab bar with dirty dots + cap hint"
```

---

### Task 7: Workspace shell + URL sync

**Files:**
- Create: `src/components/workspace/WorkspaceShell.tsx`

- [ ] **Step 1: Write the shell**

The shell composes the bar and host and keeps the address bar in step with the active tab (for deep links/refresh). Reload-restore of drafts is added in Milestone 2 (Task 14); here we only sync the URL.

```tsx
// src/components/workspace/WorkspaceShell.tsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkspaceTabBar from './WorkspaceTabBar';
import TabContentHost from './TabContentHost';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

const WorkspaceShell = (): React.ReactElement => {
    const navigate = useNavigate();
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const tabs = useWorkspaceStore((s) => s.tabs);

    const activePath = tabs.find((t) => t.id === activeTabId)?.path;

    useEffect(() => {
        if (activePath && activePath !== window.location.pathname + window.location.search) {
            navigate(activePath, { replace: true });
        }
    }, [activePath, navigate]);

    return (
        <div className="flex flex-col h-full">
            <WorkspaceTabBar />
            <div className="flex-1 min-h-0">
                <TabContentHost />
            </div>
        </div>
    );
};

export default WorkspaceShell;
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/workspace/WorkspaceShell.tsx
git commit -m "feat(workspace): shell composing bar + host + url sync"
```

---

### Task 8: Mount the shell in Layout (behind the flag)

**Files:**
- Modify: `src/components/Layout/Layout.tsx:38-40`

- [ ] **Step 1: Swap the content region**

Replace the `<main>` body so the shell renders when the flag is on, otherwise the existing `<Outlet/>`.

Add imports near the top of `Layout.tsx` (after the existing imports):

```tsx
import { WORKSPACE_TABS_ENABLED } from '../../config/featureFlags';
import WorkspaceShell from '../workspace/WorkspaceShell';
```

Change the `<main>` body from:

```tsx
                <main id="main-content" className="overflow-y-auto flex-1 p-8 bg-neutral-50 relative pt-14 md:pt-8">
                    <Outlet />
                </main>
```

to:

```tsx
                <main id="main-content" className="overflow-y-auto flex-1 p-8 bg-neutral-50 relative pt-14 md:pt-8">
                    {WORKSPACE_TABS_ENABLED ? <WorkspaceShell /> : <Outlet />}
                </main>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (With the flag unset, behavior is unchanged.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/Layout.tsx
git commit -m "feat(workspace): mount shell in layout behind VITE_WORKSPACE_TABS"
```

---

### Task 9: Foundation e2e smoke (generic tabs)

**Files:**
- Create: `e2e/workspace.spec.ts`

This proves the mechanism with the generic fallback pane before any module is wired: open two tabs by pushing to the store, confirm only the active one is visible, switch, and close.

- [ ] **Step 1: Write the e2e smoke test**

```ts
// e2e/workspace.spec.ts
import { test, expect } from '@playwright/test';

// The flag must be on for these runs: start the dev server with VITE_WORKSPACE_TABS=1.
test.describe('workspace tabs — foundation', () => {
    test('opens, keeps both mounted, switches, and closes tabs', async ({ page }) => {
        await page.goto('/');
        // Seed two generic tabs directly through the store (no module wiring yet).
        await page.evaluate(() => {
            const store = (window as any).__MSM_WORKSPACE__;
            store.openTab({ id: 't1', kind: 'list', title: 'Tab One', target: { module: 'demo', entity: 'one', recordId: '1' }, path: '/', status: 'clean' });
            store.openTab({ id: 't2', kind: 'list', title: 'Tab Two', target: { module: 'demo', entity: 'two', recordId: '2' }, path: '/', status: 'clean' });
        });
        await expect(page.getByRole('button', { name: /Tab One/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Tab Two/ })).toBeVisible();
        await expect(page.getByText('Open tabs: 2/10')).toBeVisible();

        await page.getByRole('button', { name: /Tab One/ }).click();
        await expect(page.getByText('No renderer registered for “demo/one” yet.')).toBeVisible();

        await page.getByRole('button', { name: /Tab Two/ }).locator('.workbench-doc-tab-close').click();
        await expect(page.getByRole('button', { name: /Tab Two/ })).toHaveCount(0);
    });
});
```

- [ ] **Step 2: Expose the store to e2e (dev-only)**

In `src/components/workspace/WorkspaceShell.tsx`, add a dev-only effect so Playwright can drive the store:

```tsx
    useEffect(() => {
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = useWorkspaceStore.getState();
            return useWorkspaceStore.subscribe((s) => {
                (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = s;
            });
        }
    }, []);
```

- [ ] **Step 3: Run the e2e**

Run (frontend started with the flag): `VITE_WORKSPACE_TABS=1 npm run dev` in one shell, then `npx playwright test e2e/workspace.spec.ts`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/workspace.spec.ts src/components/workspace/WorkspaceShell.tsx
git commit -m "test(workspace): foundation e2e smoke for open/switch/close"
```

---

## Milestone 2 — Sales Orders in the workspace

### Task 10: Imperative open helpers

**Files:**
- Create: `src/hooks/useWorkspaceNav.ts`

- [ ] **Step 1: Write the hook**

A thin wrapper that builds a `WorkspaceTab` from a target and opens it, surfacing the cap message. Used by the sidebar, list panes, and forms.

```ts
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
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/hooks/useWorkspaceNav.ts
git commit -m "feat(workspace): useWorkspaceNav open helper with cap alert"
```

---

### Task 11: Debounce utility + tests (TDD)

**Files:**
- Create: `src/utils/__tests__/debounce.test.ts`
- Create: `src/utils/debounce.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/debounce.test.ts
import { describe, it, expect, vi } from 'vitest';
import { debounce } from '../debounce';

describe('debounce', () => {
    it('invokes once after the delay with the latest args', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const d = debounce(spy, 200);
        d('a'); d('b'); d('c');
        expect(spy).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('c');
        vi.useRealTimers();
    });

    it('flush() invokes immediately with the pending args', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const d = debounce(spy, 200);
        d('x');
        d.flush();
        expect(spy).toHaveBeenCalledWith('x');
        vi.useRealTimers();
    });

    it('cancel() drops the pending invocation', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const d = debounce(spy, 200);
        d('x');
        d.cancel();
        vi.advanceTimersByTime(500);
        expect(spy).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/debounce.test.ts`
Expected: FAIL with "Cannot find module '../debounce'".

- [ ] **Step 3: Write the debounce util**

```ts
// src/utils/debounce.ts
export interface Debounced<A extends unknown[]> {
    (...args: A): void;
    flush: () => void;
    cancel: () => void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): Debounced<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: A | null = null;

    const run = () => {
        if (pending) { fn(...pending); pending = null; }
        timer = null;
    };

    const debounced = ((...args: A) => {
        pending = args;
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, delay);
    }) as Debounced<A>;

    debounced.flush = () => { if (timer) { clearTimeout(timer); run(); } };
    debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } pending = null; };
    return debounced;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/debounce.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/debounce.ts src/utils/__tests__/debounce.test.ts
git commit -m "feat(utils): debounce helper with flush/cancel + tests"
```

---

### Task 12: Draft autosave hook

**Files:**
- Create: `src/hooks/useDraftAutosave.ts`

- [ ] **Step 1: Write the hook**

Debounce-writes the current form snapshot into the tab's draft slot, and flushes on unmount so nothing in flight is lost. No-op when there is no `tabId` (i.e. when the form renders outside the workspace, flag off).

```ts
// src/hooks/useDraftAutosave.ts
import { useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { debounce } from '../utils/debounce';

/** Persists `snapshot` into the workspace tab `tabId` as a recoverable draft. */
export function useDraftAutosave(tabId: string | undefined, snapshot: unknown, delay = 600): void {
    const saveDraft = useWorkspaceStore((s) => s.saveDraft);
    const latest = useRef(snapshot);
    latest.current = snapshot;

    const writer = useMemo(
        () => debounce((id: string) => saveDraft(id, latest.current), delay),
        [saveDraft, delay],
    );

    useEffect(() => {
        if (!tabId) return;
        writer(tabId);
    }, [tabId, snapshot, writer]);

    useEffect(() => () => writer.flush(), [writer]);
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/hooks/useDraftAutosave.ts
git commit -m "feat(workspace): useDraftAutosave debounced snapshot persistence"
```

---

### Task 13: Make `SOFormV2` workspace-aware

**Files:**
- Modify: `src/components/ar/salesorders/SOFormV2.tsx:54-62` (props + ids)
- Modify: `src/components/ar/salesorders/SOFormV2.tsx:99-106` (seed from draft)
- Modify: `src/components/ar/salesorders/SOFormV2.tsx:220` (dirty → store)
- Modify: `src/components/ar/salesorders/SOFormV2.tsx:273-284` (save without nav)

The form keeps working unchanged when rendered by a route (flag off). When the workspace renders it, it receives `workspaceTabId` + `recordId` props, autosaves a draft, mirrors its dirty state into the tab, and on save closes its tab instead of navigating.

- [ ] **Step 1: Extend the props**

Change the props interface and signature:

```tsx
interface SOFormV2Props {
    mode?: 'create' | 'edit';
    /** Present only when rendered inside the workspace shell. */
    workspaceTabId?: string;
    /** Record id when rendered inside the workspace (replaces the soId search param). */
    recordId?: string;
}

const SOFormV2: React.FC<SOFormV2Props> = ({ mode = 'create', workspaceTabId, recordId }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const soId = recordId ?? searchParams.get('soId') ?? '';
    const isEdit = mode === 'edit';
```

- [ ] **Step 2: Seed header state from a recovered draft**

Add this just after `selectedSO` is computed (around line 79), then use `draftSeed` for the header `useState` initialisers:

```tsx
    const draftSeed = useWorkspaceStore((s) =>
        (workspaceTabId ? s.tabs.find((t) => t.id === workspaceTabId)?.draft : undefined) as
            | Partial<{ customerId: string; orderDate: string; expectedDate: string; shippingAddress: string; deliveryNotes: string; reference: string; lines: DocLine[]; tax: TaxState }>
            | undefined,
    );
```

Change the header initialisers to prefer the draft:

```tsx
    const [customerId, setCustomerId] = useState(draftSeed?.customerId ?? selectedSO?.customerId ?? '');
    const [orderDate, setOrderDate] = useState(draftSeed?.orderDate ?? selectedSO?.date ?? todayString());
    const [expectedDate, setExpectedDate] = useState(draftSeed?.expectedDate ?? selectedSO?.expectedDate ?? '');
    const [shippingAddress, setShippingAddress] = useState(draftSeed?.shippingAddress ?? selectedSO?.shippingAddress ?? '');
    const [deliveryNotes, setDeliveryNotes] = useState(draftSeed?.deliveryNotes ?? selectedSO?.deliveryNotes ?? '');
    const [reference, setReference] = useState(draftSeed?.reference ?? '');
    const [autoClose, setAutoClose] = useState('60');
    const [tax, setTax] = useState<TaxState>(draftSeed?.tax ?? { on: false, rate: TAX_RATE, mode: 'exclusive' });
```

Also seed lines from the draft when present — change `seedLines`'s early return:

```tsx
    const seedLines = useMemo<DocLine[]>(() => {
        if (draftSeed?.lines && draftSeed.lines.length) return draftSeed.lines;
        if (!selectedSO) return [];
        return (soItemTemplates[selectedSO.id] || []).map((l, i) => ({
            id: l.id || `li-${i}`,
            code: '',
            description: str(l.description),
            qty: num(l.qty),
            unit: str(l.unit) || 'PCS',
            price: num(l.price),
            discount: num(l.discount),
        }));
    }, [draftSeed, selectedSO, soItemTemplates]);
```

Add the store import alongside the existing `useSalesOrderStore` import:

```tsx
import { useWorkspaceStore } from '../../../stores/useWorkspaceStore';
```

- [ ] **Step 3: Autosave + mirror dirty into the tab**

After `const dirty = doc.dirty || !!expectedDate || !!deliveryNotes || !!reference;` (line 220), add:

```tsx
    const snapshot = useMemo(() => ({
        customerId, orderDate, expectedDate, shippingAddress, deliveryNotes, reference, tax, lines: doc.lines,
    }), [customerId, orderDate, expectedDate, shippingAddress, deliveryNotes, reference, tax, doc.lines]);

    useDraftAutosave(workspaceTabId, snapshot);

    const setStatus = useWorkspaceStore((s) => s.setStatus);
    useEffect(() => {
        if (!workspaceTabId) return;
        setStatus(workspaceTabId, dirty ? (isEdit ? 'dirty' : 'new') : (isEdit ? 'clean' : 'new'));
    }, [workspaceTabId, dirty, isEdit, setStatus]);
```

Add imports at the top:

```tsx
import { useDraftAutosave } from '../../../hooks/useDraftAutosave';
```

(`useEffect`/`useMemo` are already imported.)

- [ ] **Step 4: Save closes the tab instead of navigating**

Add near the other store selectors:

```tsx
    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const clearDraft = useWorkspaceStore((s) => s.clearDraft);
```

Replace the three handlers (lines 273-284) so that, in workspace mode, a successful save clears the draft and closes the tab; otherwise the existing navigation runs:

```tsx
    const finishSave = (id: string | null) => {
        if (!id) return;
        if (workspaceTabId) {
            clearDraft(workspaceTabId);
            closeTab(workspaceTabId);
        } else {
            navigate('/ar/sales-orders');
        }
    };

    const handleSaveDraft = async () => finishSave(await persist('Draft'));
    const handleConfirm = async () => finishSave(await persist('Confirmed'));
    const handleSaveAndInvoice = async () => finishSave(await persist('Confirmed'));
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ar/salesorders/SOFormV2.tsx
git commit -m "feat(workspace): make SOFormV2 workspace-aware (draft autosave, save-closes-tab)"
```

---

### Task 14: Reload-restore planning (pure) + tests (TDD)

**Files:**
- Create: `src/stores/workspace/__tests__/restore.test.ts`
- Create: `src/stores/workspace/restore.ts`

This is the **safety-critical** unit: deciding what to do with each persisted tab on reload. The invariant under test: a restore plan never commits/posts; saved docs are `refetch`, unsaved drafts are `reopen-draft`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/stores/workspace/__tests__/restore.test.ts
import { describe, it, expect } from 'vitest';
import { planRestore } from '../restore';
import { makeTabId, type WorkspaceTab, type TabTarget } from '../types';

const mk = (entity: string, recordId: string | null, mode: TabTarget['mode'], draft?: unknown): WorkspaceTab => {
    const target: TabTarget = { module: 'ar', entity, recordId, mode };
    return {
        id: makeTabId(target),
        kind: 'doc-form',
        title: 't',
        target,
        path: '/x',
        status: recordId === null ? 'new' : (draft ? 'dirty' : 'clean'),
        draft,
    };
};

describe('planRestore', () => {
    it('plans a refetch for saved documents', () => {
        const plan = planRestore([mk('sales-order', 'SO-1', 'view')]);
        expect(plan).toEqual([{ tabId: mk('sales-order', 'SO-1', 'view').id, action: 'refetch', recordId: 'SO-1' }]);
    });

    it('plans reopen-draft for an unsaved new form', () => {
        const tab = mk('sales-order', null, 'create', { customerId: 'C1' });
        const plan = planRestore([tab]);
        expect(plan).toEqual([{ tabId: tab.id, action: 'reopen-draft' }]);
    });

    it('plans reopen-draft for a dirty edit form that has a draft', () => {
        const tab = mk('sales-order', 'SO-9', 'edit', { reference: 'half typed' });
        const plan = planRestore([tab]);
        expect(plan).toEqual([{ tabId: tab.id, action: 'reopen-draft' }]);
    });

    it('NEVER plans a commit/post for any tab (the load-bearing invariant)', () => {
        const plan = planRestore([
            mk('sales-order', 'SO-1', 'view'),
            mk('sales-order', null, 'create', { customerId: 'C1' }),
            mk('invoice', 'INV-2', 'edit', { x: 1 }),
        ]);
        expect(plan.every((p) => p.action === 'refetch' || p.action === 'reopen-draft')).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/workspace/__tests__/restore.test.ts`
Expected: FAIL with "Cannot find module '../restore'".

- [ ] **Step 3: Write the planner**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/workspace/__tests__/restore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspace/restore.ts src/stores/workspace/__tests__/restore.test.ts
git commit -m "feat(workspace): pure restore planner with never-auto-post invariant"
```

---

### Task 15: Sales-order list pane (opens workspace tabs)

**Files:**
- Create: `src/components/ar/salesorders/SalesOrderListPane.tsx`

A catalog-only list (reusing `SOCatalogPanel`) that, instead of the per-module `DocumentTabBar`, opens a document tab in the global workspace.

- [ ] **Step 1: Write the list pane**

```tsx
// src/components/ar/salesorders/SalesOrderListPane.tsx
import React, { useMemo, useState } from 'react';
import SOCatalogPanel from './SOCatalogPanel';
import PageHeader from '../../Layout/PageHeader';
import { useSalesOrders } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface SOFilters { searchTerm: string; status: string; dateFrom: string; dateTo: string }

const SalesOrderListPane = (): React.ReactElement => {
    const { canEdit } = useModulePermissions('ar_sales_orders');
    const { open } = useWorkspaceNav();
    const { data: soResult } = useSalesOrders();
    const salesOrders = soResult?.data ?? [];

    const [filters, setFilters] = useState<SOFilters>({ searchTerm: '', status: '', dateFrom: '', dateTo: '' });

    const filteredData = useMemo(() => salesOrders.filter((item) => {
        const keyword = filters.searchTerm.toLowerCase();
        const matchesSearch = (item.customerName || '').toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword);
        const matchesStatus = filters.status ? item.status === filters.status : true;
        return matchesSearch && matchesStatus;
    }), [filters, salesOrders]);

    const openView = (soId: string) => {
        const so = salesOrders.find((s) => s.id === soId);
        open({
            kind: 'doc-view',
            target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'view' },
            title: so?.number || soId,
            path: `/ar/sales-orders?soId=${soId}`,
        });
    };

    const openEdit = (soId: string) => {
        const so = salesOrders.find((s) => s.id === soId);
        open({
            kind: 'doc-form',
            target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
            title: `Edit ${so?.number || soId}`,
            path: `/ar/sales-orders/edit?soId=${soId}`,
        });
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader title="Sales Orders" subtitle="Manage quotations and confirmed orders before invoicing." />
            <SOCatalogPanel
                data={filteredData as unknown as { id: string; [key: string]: unknown }[]}
                selectedId=""
                filters={filters as unknown as { searchTerm: string; status: string; dateFrom: string; dateTo: string; [key: string]: string }}
                onSearchChange={(searchTerm) => setFilters((p) => ({ ...p, searchTerm }))}
                onFilterChange={(key, value) => setFilters((p) => ({ ...p, [key]: value }))}
                onDateRangeChange={(key, value) => setFilters((p) => ({ ...p, [key]: value }))}
                onSelectSalesOrder={openView}
                onViewSalesOrder={openView}
                canEdit={canEdit}
                onEditSalesOrder={openEdit}
                onPrintSalesOrder={() => {}}
            />
        </div>
    );
};

export default SalesOrderListPane;
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/ar/salesorders/SalesOrderListPane.tsx
git commit -m "feat(workspace): sales-order list pane that opens workspace tabs"
```

---

### Task 16: Register Sales Orders in the tab registry

**Files:**
- Modify: `src/components/workspace/tabRegistry.tsx`

- [ ] **Step 1: Add the SO branches**

```tsx
// src/components/workspace/tabRegistry.tsx
import React from 'react';
import type { WorkspaceTab } from '../../stores/workspace/types';
import SOFormV2 from '../ar/salesorders/SOFormV2';
import SalesOrderListPane from '../ar/salesorders/SalesOrderListPane';
import SODetailPane from '../ar/salesorders/SODetailPane';

export function renderTab(tab: WorkspaceTab): React.ReactNode {
    const { module, entity, mode, recordId } = tab.target;

    if (module === 'ar' && entity === 'sales-order') {
        if (tab.kind === 'list') return <SalesOrderListPane />;
        if (tab.kind === 'doc-form') {
            return <SOFormV2 mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} recordId={recordId ?? undefined} />;
        }
        if (tab.kind === 'doc-view') return <SODetailPane soId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for “{module}/{entity}” yet.</div>
        </div>
    );
}
```

- [ ] **Step 2: Write the read-only detail pane**

Create `src/components/ar/salesorders/SODetailPane.tsx` wrapping the existing `SODetailTabs`, refetching on mount so a reactivated tab is never stale:

```tsx
// src/components/ar/salesorders/SODetailPane.tsx
import React, { useEffect } from 'react';
import SODetailTabs from './SODetailTabs';
import { useSalesOrders } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface Props { soId: string; workspaceTabId: string }

const SODetailPane = ({ soId }: Props): React.ReactElement => {
    const { canEdit } = useModulePermissions('ar_sales_orders');
    const { canCreate: canCreateInvoice } = useModulePermissions('ar_invoices');
    const { open } = useWorkspaceNav();
    const { data: soResult, refetch } = useSalesOrders();

    useEffect(() => { refetch(); }, [soId, refetch]); // freshen on (re)activation

    const so = (soResult?.data ?? []).find((s) => s.id === soId) || null;
    if (!so) return <div className="invoice-workbench-card"><div className="empty-detail">Sales order not found.</div></div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
        title: `Edit ${so.number || soId}`,
        path: `/ar/sales-orders/edit?soId=${soId}`,
    });

    return (
        <SODetailTabs
            salesOrder={so as unknown as Record<string, unknown>}
            lineItems={((so as unknown as { items?: unknown[] }).items ?? []) as Record<string, unknown>[]}
            onEdit={openEdit}
            onPrint={() => {}}
            onConvertToInvoice={() => {}}
            canEdit={canEdit}
            canConvertToInvoice={canCreateInvoice}
        />
    );
};

export default SODetailPane;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/tabRegistry.tsx src/components/ar/salesorders/SODetailPane.tsx
git commit -m "feat(workspace): register sales-order list/form/detail tabs"
```

---

### Task 17: Seed the SO list tab + sidebar/New wiring

**Files:**
- Modify: `src/components/workspace/WorkspaceShell.tsx`

When the workspace is empty (fresh app, flag on) and the user navigates to `/ar/sales-orders`, open the SO list tab; add a "New sales order" entry point via the existing sidebar route by mapping it through `useWorkspaceNav`. For Phase 1 we bootstrap from the URL.

- [ ] **Step 1: Add URL → tab bootstrap + restore on mount**

Extend `WorkspaceShell` with a mount effect that (a) runs `planRestore` over persisted tabs to drop nothing and keep drafts as forms, and (b) opens a tab matching the current URL if none is active. Replace the shell body with:

```tsx
// src/components/workspace/WorkspaceShell.tsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import WorkspaceTabBar from './WorkspaceTabBar';
import TabContentHost from './TabContentHost';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';

const WorkspaceShell = (): React.ReactElement => {
    const navigate = useNavigate();
    const location = useLocation();
    const { open } = useWorkspaceNav();
    const tabs = useWorkspaceStore((s) => s.tabs);
    const activeTabId = useWorkspaceStore((s) => s.activeTabId);
    const activePath = tabs.find((t) => t.id === activeTabId)?.path;

    useEffect(() => {
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = useWorkspaceStore.getState();
            return useWorkspaceStore.subscribe((s) => {
                (window as unknown as Record<string, unknown>).__MSM_WORKSPACE__ = s;
            });
        }
    }, []);

    // Bootstrap a tab from the URL when nothing is active (deep link / fresh load).
    useEffect(() => {
        if (activeTabId) return;
        const path = location.pathname;
        if (path.startsWith('/ar/sales-orders/new')) {
            open({ kind: 'doc-form', target: { module: 'ar', entity: 'sales-order', recordId: null, mode: 'create' }, title: 'New sales order', path: '/ar/sales-orders/new' });
        } else if (path.startsWith('/ar/sales-orders')) {
            open({ kind: 'list', target: { module: 'ar', entity: 'sales-order', recordId: 'catalog', mode: 'view' }, title: 'Sales Orders', path: '/ar/sales-orders' });
        }
        // other modules: handled as they are migrated in later phases.
    }, [activeTabId, location.pathname, open]);

    useEffect(() => {
        if (activePath && activePath !== window.location.pathname + window.location.search) {
            navigate(activePath, { replace: true });
        }
    }, [activePath, navigate]);

    return (
        <div className="flex flex-col h-full">
            <WorkspaceTabBar />
            <div className="flex-1 min-h-0">
                <TabContentHost />
            </div>
        </div>
    );
};

export default WorkspaceShell;
```

Note: persisted draft tabs are already rehydrated by the store; because `renderTab` builds the SO form from `tab.draft`, a reopened draft is an editable form — never a posted record. `planRestore` is exercised by its unit test and documents the guarantee; the runtime relies on the same rule (drafts render as forms, saved docs refetch in `SODetailPane`).

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/workspace/WorkspaceShell.tsx
git commit -m "feat(workspace): bootstrap SO tabs from URL + dev store bridge"
```

---

### Task 18: Sales-order workspace e2e (keep-alive, reload, never-auto-post)

**Files:**
- Modify: `e2e/workspace.spec.ts`

- [ ] **Step 1: Add the SO scenarios**

```ts
// append to e2e/workspace.spec.ts
test.describe('workspace tabs — sales orders', () => {
    test('keep-alive preserves a half-typed new SO across a tab switch', async ({ page }) => {
        await page.goto('/ar/sales-orders/new');
        // type a reference on the Additional info tab
        await page.getByRole('button', { name: 'Additional info' }).click();
        await page.getByPlaceholder(/reference/i).fill('KEEP-ALIVE-123');
        // open the SO list as a second tab, then come back
        await page.evaluate(() => {
            (window as any).__MSM_WORKSPACE__.openTab({ id: 'ar:sales-order:view:catalog', kind: 'list', title: 'Sales Orders', target: { module: 'ar', entity: 'sales-order', recordId: 'catalog', mode: 'view' }, path: '/ar/sales-orders', status: 'clean' });
        });
        await page.getByRole('button', { name: /New sales order/ }).click();
        await page.getByRole('button', { name: 'Additional info' }).click();
        await expect(page.getByPlaceholder(/reference/i)).toHaveValue('KEEP-ALIVE-123');
    });

    test('reload restores the unsaved draft as a form and posts nothing', async ({ page }) => {
        await page.goto('/ar/sales-orders/new');
        await page.getByRole('button', { name: 'Additional info' }).click();
        await page.getByPlaceholder(/reference/i).fill('SURVIVE-RELOAD');
        await page.waitForTimeout(800); // let the debounced autosave flush
        const before = await page.evaluate(() => (window as any).__MSM_WORKSPACE__.tabs.length);
        await page.reload();
        // the draft tab is back, as an editable form, with the typed value intact
        await page.getByRole('button', { name: /New sales order/ }).click();
        await page.getByRole('button', { name: 'Additional info' }).click();
        await expect(page.getByPlaceholder(/reference/i)).toHaveValue('SURVIVE-RELOAD');
        const after = await page.evaluate(() => (window as any).__MSM_WORKSPACE__.tabs.length);
        expect(after).toBe(before); // no extra/committed document
    });
});
```

- [ ] **Step 2: Run e2e**

Run (flag on): `npx playwright test e2e/workspace.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/workspace.spec.ts
git commit -m "test(workspace): SO keep-alive + reload-restore + never-auto-post"
```

---

## Milestone 3 — Invoices in the workspace

Invoices reuse every foundation piece; only entity-specific wiring differs. `InvoiceForm` lives at `src/views/ar/InvoiceForm.tsx` and is not yet on the shared scaffold, so this milestone wires it as-is (props + save-closes-tab + autosave) without porting it.

### Task 19: Make `InvoiceForm` workspace-aware

**Files:**
- Modify: `src/views/ar/InvoiceForm.tsx`

- [ ] **Step 1: Read the form first**

Run: open `src/views/ar/InvoiceForm.tsx` and locate (a) its props/signature, (b) where it reads its record id (search param), (c) its save handlers and post-save `navigate(...)` calls, (d) the local state it holds for the document body.

- [ ] **Step 2: Add workspace props + draft seed**

Mirror Task 13 exactly, substituting invoice fields:
- Add `workspaceTabId?: string` and `recordId?: string` to the props; resolve `invoiceId = recordId ?? searchParams.get('invoiceId') ?? ''`.
- Read `draftSeed` from `useWorkspaceStore` by `workspaceTabId` and prefer it in each header `useState` initialiser and in the line seed.
- Build a `snapshot` memo of the invoice's editable state and call `useDraftAutosave(workspaceTabId, snapshot)`.
- Mirror dirty into the tab with `setStatus` as in Task 13 Step 3.

- [ ] **Step 3: Save closes the tab**

Add `closeTab`/`clearDraft` selectors and a `finishSave(id)` that, when `workspaceTabId` is set, clears the draft and closes the tab; otherwise runs the existing `navigate('/ar/invoices')`. Route every save handler through `finishSave`.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/views/ar/InvoiceForm.tsx
git commit -m "feat(workspace): make InvoiceForm workspace-aware"
```

---

### Task 20: Invoice list pane + detail pane + registry

**Files:**
- Create: `src/components/ar/invoices/InvoiceListPane.tsx`
- Create: `src/components/ar/invoices/InvoiceDetailPane.tsx`
- Modify: `src/components/workspace/tabRegistry.tsx`
- Modify: `src/components/workspace/WorkspaceShell.tsx` (URL bootstrap for `/ar/invoices`)

- [ ] **Step 1: Invoice list pane**

Copy `SalesOrderListPane` (Task 15) to `InvoiceListPane.tsx`, swapping: `useSalesOrders` → `useInvoices` (from `../../../hooks/useAR`), the catalog component to the invoices catalog (`InvoiceCatalogPanel` if present; otherwise reuse the invoices list view's table), permission key `ar_sales_orders` → `ar_invoices`, and targets `entity: 'invoice'` with paths `/ar/invoices?invoiceId=` and `/ar/invoices/edit?invoiceId=`.

- [ ] **Step 2: Invoice detail pane**

Copy `SODetailPane` (Task 16) to `InvoiceDetailPane.tsx`, swapping the detail component to the invoice detail (`InvoiceDetailTabs`), `useSalesOrders` → `useInvoices`, and the edit target to `entity: 'invoice'`. Keep the `useEffect(() => { refetch(); }, ...)` freshen-on-activation.

- [ ] **Step 3: Register invoice branches**

In `renderTab`, add an `module === 'ar' && entity === 'invoice'` block mirroring the sales-order block: `list` → `InvoiceListPane`, `doc-form` → `InvoiceForm` with `workspaceTabId`/`recordId`, `doc-view` → `InvoiceDetailPane`.

- [ ] **Step 4: URL bootstrap**

In `WorkspaceShell`'s bootstrap effect, add branches: `/ar/invoices/new` → invoice create form tab; `/ar/invoices` → invoice list tab. Same shape as the sales-order branches.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/ar/invoices/InvoiceListPane.tsx src/components/ar/invoices/InvoiceDetailPane.tsx src/components/workspace/tabRegistry.tsx src/components/workspace/WorkspaceShell.tsx
git commit -m "feat(workspace): wire invoices (list/form/detail) into the workspace"
```

---

### Task 21: Invoice workspace e2e

**Files:**
- Modify: `e2e/workspace.spec.ts`

- [ ] **Step 1: Add invoice keep-alive + reload scenarios**

Duplicate the two sales-order e2e tests (Task 18) for invoices: navigate to `/ar/invoices/new`, type into a stable invoice field, switch tabs and assert the value survives; then reload and assert the draft reopens as a form with no extra committed invoice (`tabs.length` unchanged, and the invoices list count unchanged).

- [ ] **Step 2: Run e2e + commit**

Run: `npx playwright test e2e/workspace.spec.ts`
Expected: PASS.

```bash
git add e2e/workspace.spec.ts
git commit -m "test(workspace): invoice keep-alive + reload-restore"
```

---

## Milestone 4 — Non-AR modules + ship

### Task 22: Generic single-tab fallback for other modules

**Files:**
- Modify: `src/components/workspace/WorkspaceShell.tsx`
- Modify: `src/components/workspace/tabRegistry.tsx`

So the app is fully usable with the flag on, every other sidebar destination opens as a single tab that renders the existing route component. Rather than duplicate `App.tsx`'s lazy map, render the matched route via a nested `<Routes>` inside one "page" tab.

- [ ] **Step 1: Add a `page` fallback in the registry**

When a tab's `module` is not yet migrated, render the app's existing routes for that path inside the pane:

```tsx
    if (tab.kind === 'list' && tab.target.module === 'page') {
        // Renders whatever the existing route table maps `tab.path` to.
        return <PageTab path={tab.path} />;
    }
```

Create `src/components/workspace/PageTab.tsx` that renders the existing route element for a path. The simplest correct implementation reuses the app's route definitions; extract the inner `<Routes>…</Routes>` from `App.tsx` into `src/AppRoutes.tsx` and render `<MemoryRouter initialEntries={[path]}><AppRoutes/></MemoryRouter>` is **not** acceptable (nested routers fight the URL). Instead, render the lazy component directly by mapping `tab.path` → component in a small `pageComponentFor(path)` table that imports the same lazies. Keep this table to the destinations a user actually opens (dashboard, reports, settings, lists for non-migrated modules).

- [ ] **Step 2: Bootstrap non-AR sidebar clicks**

In `WorkspaceShell`'s bootstrap effect, for any path not handled by AR branches, open a `page` tab titled from a small `titleFor(path)` map. Opening the same path focuses the existing tab (idempotent by `makeTabId`, with `recordId = path`).

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit`
Expected: PASS. Then with the flag on, click each top-level sidebar item and confirm it opens as a tab and renders.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/PageTab.tsx src/components/workspace/tabRegistry.tsx src/components/workspace/WorkspaceShell.tsx
git commit -m "feat(workspace): single-tab fallback for non-migrated modules"
```

---

### Task 23: Sidebar opens tabs (flag-aware)

**Files:**
- Modify: `src/components/Layout/Sidebar.tsx`

- [ ] **Step 1: Route sidebar navigation through the workspace when the flag is on**

Read `Sidebar.tsx` first. Where each item currently `navigate(path)`s, when `WORKSPACE_TABS_ENABLED` is true, call `useWorkspaceNav().open(...)` for AR destinations and a `page` tab for the rest, falling back to `navigate(path)` (which the shell's bootstrap effect turns into a tab). The minimal change is to keep `navigate(path)` and rely entirely on the shell bootstrap effect — verify that path works before adding direct `open()` calls.

- [ ] **Step 2: Manual smoke + commit**

With the flag on, click sidebar items and confirm each opens/focuses a tab.

```bash
git add src/components/Layout/Sidebar.tsx
git commit -m "feat(workspace): sidebar navigation opens workspace tabs when enabled"
```

---

### Task 24: Full unit + e2e green, then enable the flag

**Files:**
- Modify: `.env.example` (document the flag), local `.env` (turn it on)

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: PASS (existing 26+ tests plus the new reducer/restore/debounce tests).

- [ ] **Step 2: Run the workspace e2e**

Run (flag on): `npx playwright test e2e/workspace.spec.ts`
Expected: PASS.

- [ ] **Step 3: Document + enable the flag**

Add to `.env.example`:

```
# Multi-document workspace (Accurate-style tabs). 1 = on.
VITE_WORKSPACE_TABS=1
```

Set `VITE_WORKSPACE_TABS=1` in the local `.env` and restart the dev server. Manually confirm: open a new SO, switch to the SO list and back (input preserved), reload (draft reopens as a form), close a dirty tab (confirm prompt), and that no stray sales order/invoice was created.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "feat(workspace): document + enable VITE_WORKSPACE_TABS"
```

---

## Self-review notes (author check)

- **Spec coverage:** global tabs (Tasks 5–8), restore-everything incl. drafts (Tasks 12–14, 17–18), AR-first SO (M2) + Invoice (M3), keep-alive host (Task 5), tab cap ~10 (`TAB_CAP=10`, Tasks 1/6/10), close-dirty guard (Task 6), stale-on-focus refetch (Tasks 16/20 detail panes), per-tab error boundary (Task 5), draft autosave (Tasks 11–13), never-auto-post invariant (Task 14 unit + Task 18 e2e), non-AR modules keep working (M4). All spec sections map to a task.
- **Type consistency:** `WorkspaceTab`/`TabTarget`/`TabStatus`/`makeTabId`/`TAB_CAP` are defined once in `types.ts` and reused everywhere; reducer names match the store and tests (`openTab`, `closeTab`, `closeOthers`, `closeAll`, `activateTab`, `reorderTab`, `setStatus`, `saveDraft`, `clearDraft`, `isAtCap`).
- **Known risk to validate during execution:** the workbench reads SOs from `useSalesOrders()` (server) while `SOFormV2` persists to the `useSalesOrderStore` (localStorage). This pre-existing split is orthogonal to the workspace but means a freshly-saved SO may not appear in the server-backed list until that inconsistency is reconciled — flag it if it surfaces during Task 18.
- **Placeholder scan:** Milestone 3–4 tasks reference concrete files/patterns and the exact deltas from their Milestone 2 equivalents; before executing M3/M4, read the named source files (`InvoiceForm.tsx`, `Sidebar.tsx`) as instructed in their first step.
