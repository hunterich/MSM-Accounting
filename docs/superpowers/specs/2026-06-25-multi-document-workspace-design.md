# Multi-document workspace (Accurate-style tabs) — design

- Date: 2026-06-25
- Status: Approved design, ready for implementation plan
- Scope: Phase 1 (AR-first: Sales Orders + Invoices)

## Problem

Today every form takes over the whole content area. The app renders a single
React Router `<Outlet/>` inside `<main>` (`src/components/Layout/Layout.tsx`),
and routes like `/ar/sales-orders/new` mount `SOFormV2`
(`src/components/ar/salesorders/SOFormV2.tsx`) as a full-page replacement.
Navigating away unmounts the form and discards all in-progress local state.

Real bookkeeping is interrupt-driven: you are half-way through a new sales
order when the boss asks for a sales report. Right now you must save a draft,
leave the form, open the report, then navigate back and re-open the form —
many clicks, and any unsaved typing is lost. The user has used Accurate Online
for 5 years and expects its multi-document workspace, where many documents and
reports stay open as tabs and you switch between them freely without losing
work.

## Goals

- Open many documents/reports at once as tabs and switch instantly, app-wide.
- Never lose in-progress work to a context switch or an app reload/restart.
- Match Accurate's mental model so it feels familiar on day one.

## Non-goals (YAGNI)

- Migrating every module in Phase 1. Only Sales Orders + Invoices get the full
  multi-document treatment now; other modules keep working unchanged and are
  migrated tab-by-tab later.
- Split-screen / side-by-side panes. Tabs only for now. (Comparing two orders
  is done by switching tabs, which is instant.)
- Real-time collaborative editing or cross-user tab sync.

## Decisions (locked with the user)

1. **Pattern: Option A — global workspace tabs.** One tab strip across the
   whole app; a sales order, an invoice, and a report can be open together
   regardless of module. (Rejected: per-module tabs — closer to current code
   but can't show a sales order and a purchase order at the same time.)
2. **Reload behavior: Option 1 — restore everything, including unsaved
   drafts.** Reopening the app restores the open tabs; saved documents refetch
   fresh; unsaved new forms reopen pre-filled from an autosaved draft snapshot.
3. **Rollout: Option 1 — phased, AR-first.** Build the shell once, wire SO +
   Invoice, prove it, then migrate the rest.

## Architecture

### Workspace shell

Replace the single `<Outlet/>` in `Layout.tsx` with a `WorkspaceShell` that
renders:

- A persistent global tab bar pinned at the top of the content area (right of
  the sidebar). Reuse/extend the existing `DocumentTabBar`
  (`src/components/UI/DocumentTabBar.tsx`) rather than building a new one.
- A **content host** below it that keeps every open tab **mounted** and toggles
  visibility (active tab shown, others `hidden`) instead of unmounting. This is
  what makes in-session switching instant and lossless — local component state,
  scroll position, and focus all survive because the component never unmounts.

The sidebar's role narrows from "navigate (replace screen)" to "open a tab."

### Workspace store

New persisted Zustand store `useWorkspaceStore` (localStorage, `persist`
middleware, following the existing store pattern e.g.
`src/stores/useSalesOrderStore.ts`). It is the single source of truth for the
workspace and what enables reload-restore.

State:

- `tabs: WorkspaceTab[]` — ordered.
- `activeTabId: string | null`.

`WorkspaceTab`:

- `id` — stable tab id.
- `kind` — `'doc-form' | 'doc-view' | 'list' | 'report'`.
- `target` — what to render: module + entity + record id (or `new`) + mode.
- `title` / `icon` — e.g. doc number + customer; `New sales order` for new.
- `status` — `'clean' | 'dirty' | 'new'` (drives the unsaved dot).
- `draft?` — serialized form snapshot for `doc-form` tabs (autosaved).

Actions: `openTab`, `closeTab`, `closeOthers`, `closeAll`, `activateTab`,
`reorderTab`, `setDirty`, `saveDraft`, `clearDraft`. `openTab` is
idempotent — opening an already-open record activates its existing tab instead
of duplicating it.

Constraints/behavior:

- **Tab cap ~10.** Opening past the cap prompts the user to close a tab first.
- **Close-dirty guard.** Closing a tab whose `status` is `dirty`/`new` shows a
  "Discard unsaved changes?" confirm.
- **Stale-data refresh.** `doc-view` tabs refetch on activation (React Query
  invalidate/refetch) so reactivating never shows old numbers.

### Tab content host + registry

A `tabRegistry` maps `kind` + `target` to a component:

- `doc-form` → `SOFormV2` / `InvoiceForm`
  (`src/views/ar/InvoiceForm.tsx`).
- `doc-view` → existing SO / Invoice detail views.
- `list` → existing list/workbench views.
- `report` → report views.

The host renders one `<TabPane>` per open tab; each pane is wrapped in its own
`ErrorBoundary` (reuse `src/components/UI/ErrorBoundary.jsx`) so a single
crashing tab cannot take down the workspace.

### Navigation + URL integration

- Sidebar items and "New / Edit / Open" actions call
  `workspaceStore.openTab(...)` instead of `navigate(fullPageRoute)`.
- Keep a thin URL sync: the active tab writes its canonical path to the address
  bar (`navigate(path, { replace: true })`) so deep links and refresh still
  resolve to a sensible tab. Content is store-driven, not `<Outlet/>`-driven.
- Routes in `App.tsx` are reorganized so the workspace host is the layout and
  the existing per-route components are reached through the registry. Permission
  gating (`withPermission`) is preserved at the point a tab is opened.

### Draft autosave + recovery (safety-critical)

Two layers solve two different moments:

- **In-session** (switch to a report and back): handled entirely by keep-alive;
  the form never unmounts, so it is untouched.
- **Across reload/restart**: each form debounce-autosaves its serializable
  working state into its tab's `draft` snapshot (persisted via the store). On
  reopen:
  - Saved documents (have a server id) **refetch fresh** from the server.
  - Unsaved `new`/`dirty` forms **reopen as an editable form**, pre-filled from
    the draft snapshot and badged "Draft — unsaved."

**Hard rule: a recovered draft never writes to the accounting ledger until the
user explicitly hits Save/Confirm.** Recovery only ever returns the user to the
form. This is the invariant that keeps "never lose my work" from becoming
"accidentally posted/double-posted an order." A draft snapshot is UI state, not
a persisted document, and carries no posting side effects.

Note: `SOFormV2` currently does not persist the additional-costs/tax breakdown
(see its header comment). The draft snapshot must capture the full in-form state
including costs/tax so recovery is faithful; persisting that breakdown for saved
SOs is a related follow-up but not required for draft recovery.

## Phase 1 scope

Build once, then wire AR:

- Shell + store + keep-alive host + tab registry + draft autosave/recovery.
- Sales Orders: list, new/edit form (`SOFormV2`), detail view → all open as
  tabs.
- Invoices: list, new/edit form (`InvoiceForm`), detail view → all open as tabs.
- All other modules: unchanged behavior, each opens as a single tab; migrated in
  later phases.

## Error handling

- Per-tab `ErrorBoundary`; a crashing tab shows a fallback, the rest keep
  working.
- Draft autosave failure: keep last-good draft in memory, surface a small
  "couldn't save draft" hint, do not block typing.
- Corrupt/unrehydratable draft on reopen: drop it gracefully, tell the user,
  never crash the workspace.
- Tab cap reached: explicit prompt to close a tab; never silently drop one.

## Build sequence

1. `useWorkspaceStore` + types + unit tests for the reducers (open/close/
   activate/reorder/dirty/cap/idempotent-open).
2. `WorkspaceShell` + content host + per-tab `ErrorBoundary`; mount it in
   `Layout.tsx` behind a feature flag so the old routing still works during
   development.
3. Tab bar wiring (extend `DocumentTabBar`): titles, active state, unsaved dot,
   close, close-others/all, reorder, cap prompt.
4. `useDraftAutosave` hook (debounced) + draft snapshot read/write in the store.
5. Wire Sales Orders (list + `SOFormV2` + detail) to open as tabs; add dirty
   tracking + close-dirty guard.
6. Wire Invoices (list + `InvoiceForm` + detail) the same way.
7. Reload-restore: rehydrate tabs, refetch saved docs, reopen drafts as forms
   with the "never auto-post" rule.
8. URL sync + permission gating at open-time; flip the feature flag on.
9. Polish: stale-on-focus refetch for `doc-view`, tab cap UX, empty/edge states.

## Test plan

- **Unit (store):** open/close/activate/reorder, dirty transitions, cap
  enforcement, idempotent `openTab`, draft save/clear.
- **Unit (autosave):** debounce; snapshot captures full form state incl.
  costs/tax.
- **Component:** keep-alive (type in SO form → switch tab → return → input
  intact); close-dirty confirm; tab bar interactions.
- **Integration / e2e:**
  - Type a new SO → open a report tab → return → SO input fully preserved.
  - Reload app → open tabs restored; saved doc shows fresh data; unsaved draft
    reopens as an editable form badged "Draft — unsaved."
  - Close a dirty tab → confirm prompt; cancel keeps it, confirm discards.
  - Reactivating a `doc-view` tab refetches (no stale numbers).
- **Invariant (ties into existing GL invariant harness, `npm run test:int`):**
  a recovered/restored draft creates **no** ledger entry until an explicit
  Save/Confirm. This is the load-bearing safety test.

## Deferred / later phases

- Migrate PO, Bill, returns, payments, and reports into the workspace.
- Persist the additional-costs/tax breakdown for saved Sales Orders.
- Split-screen / side-by-side panes (if ever wanted beyond tab switching).
