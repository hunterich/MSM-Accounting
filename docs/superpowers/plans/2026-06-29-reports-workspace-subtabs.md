# Reports Workspace Sub-Tabs Migration (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Reports module into the PR#88 workspace two-level tab system so each opened report is an Accurate-style second-row sub-tab, the report card grid is the module's catalog tab, and a generated report shows only itself (no "Laporan Lainnya" cards).

**Architecture:** Reports becomes a workspace *document module*. Rather than physically splitting the 3,600-line `Reports.tsx`, we parametrize it with a `variant` prop: `'legacy'` (default — unchanged standalone-route behaviour), `'catalog'` (renders only the category sidebar + cards; running a report calls a callback), and `'single'` (renders exactly one report from props, no catalog, no other-report cards). Two thin wrapper components bridge the workspace store to those variants, and the `tabRegistry` renders them. Report-run params ride on the workspace tab's `draft` via `saveDraft`.

**Tech Stack:** React 19 + TypeScript, Zustand (`useWorkspaceStore`), React Router 7, Vitest (`vitest run`), Playwright (`playwright test`), `tsc --noEmit`.

---

## Why parametrize instead of split

`Reports.tsx` holds ~1,300 lines of per-report render logic (`renderReportResult`, lines 1729–3035), the parameter modal (3260–3620), CSV/PDF/print handlers, and the run flow — all closed over component state. Physically extracting that is high-risk churn. Adding a `variant` prop and gating the three top-level JSX regions reuses every existing renderer untouched, keeps the legacy route behaviour byte-for-byte (zero risk for flag-off users), and confines new logic to a handful of small, well-bounded changes.

## File structure

- `src/stores/workspace/modules.ts` (modify) — register `reports` as a document module; map its tabs; drop `/reports` from page modules; give the standalone bank-reconciliation route its own page-module key.
- `src/stores/workspace/__tests__/modules.test.ts` (create) — unit tests for the registry changes.
- `src/components/workspace/TwoLevelTabBar.tsx` (modify) — render the second-row "New (+)" button only when the active doc module defines a `newPath`.
- `src/components/workspace/WorkspaceShell.tsx` (modify) — open the Reports catalog tab when navigating to `/reports`.
- `src/views/reports/Reports.tsx` (modify) — add the `variant` prop + `ReportsProps`; gate the catalog / active-report / internal-tab-strip / "Laporan Lainnya" regions; branch the run action; fetch-on-mount for `single`; export `findReportById`.
- `src/components/workspace/ReportsCatalogTab.tsx` (create) — `variant="catalog"` wrapper that opens a report sub-tab + stores its params.
- `src/components/workspace/ReportsReportTab.tsx` (create) — `variant="single"` wrapper that reads its tab's draft params and persists "Ubah Filter" changes.
- `src/components/workspace/tabRegistry.tsx` (modify) — render the two wrappers for `module === 'reports'`.
- `e2e/workspace-reports.spec.ts` (create) — Reports renders as a doc module (catalog button, no New button) and a card opens a `report` tab.

---

## Task 1: Register Reports as a workspace document module

**Files:**
- Modify: `src/stores/workspace/modules.ts`
- Test: `src/stores/workspace/__tests__/modules.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/stores/workspace/__tests__/modules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moduleKeyOf, isDocumentModule, docModuleTitle, pageModuleForPath, DOC_MODULES } from '../modules';

describe('reports workspace module registration', () => {
  it('groups every reports tab under the single "reports" module key', () => {
    expect(moduleKeyOf({ module: 'reports', entity: 'catalog', recordId: 'catalog', mode: 'view' })).toBe('reports');
    expect(moduleKeyOf({ module: 'reports', entity: 'bank-history', recordId: null, mode: 'view' })).toBe('reports');
  });

  it('is a document module titled "Reports" with no "New" action', () => {
    expect(isDocumentModule('reports')).toBe(true);
    expect(docModuleTitle('reports')).toBe('Reports');
    expect(DOC_MODULES['reports'].newPath).toBeFalsy();
    expect(DOC_MODULES['reports'].listPath).toBe('/reports');
  });

  it('keeps the standalone bank-reconciliation route as its own page module', () => {
    expect(pageModuleForPath('/reports/bank-reconciliation').key).toBe('reports-reconciliation');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/stores/workspace/__tests__/modules.test.ts`
Expected: FAIL — `isDocumentModule('reports')` is `false` and `pageModuleForPath('/reports/bank-reconciliation').key` is `'reports'`.

- [ ] **Step 3: Implement the registry changes**

In `src/stores/workspace/modules.ts`:

In `moduleKeyOf`, add the reports mapping as the first check inside the function body (before the `ar` check):

```ts
    if (t.module === 'reports') return 'reports';
```

Add to `DOC_MODULE_TITLES` (after the `'banking': 'Banking',` entry):

```ts
    'reports': 'Reports',
```

Change the `DOC_MODULES` value type so the "New" action is optional, then add the reports entry. Update the type annotation:

```ts
export const DOC_MODULES: Record<string, {
    module: string;
    entity: string;
    title: string;
    newLabel?: string;
    listPath: string;
    newPath?: string;
}> = {
```

Add to `DOC_MODULES` (after the `'banking': { ... }` entry):

```ts
    'reports': { module: 'reports', entity: 'catalog', title: 'Reports', listPath: '/reports' },
```

In `PAGE_MODULES`, replace the line:

```ts
    ['/reports', { key: 'reports', title: 'Reports' }],
```

with:

```ts
    ['/reports/bank-reconciliation', { key: 'reports-reconciliation', title: 'Bank reconciliation' }],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/stores/workspace/__tests__/modules.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspace/modules.ts src/stores/workspace/__tests__/modules.test.ts
git commit -m "feat(workspace): register Reports as a document module"
```

---

## Task 2: Make the second-row "New (+)" button optional

**Files:**
- Modify: `src/components/workspace/TwoLevelTabBar.tsx`

Reports has no "new document", so its second row must show only the catalog button + report sub-tabs.

- [ ] **Step 1: Guard `openNew` against modules without a `newPath`**

In `src/components/workspace/TwoLevelTabBar.tsx`, change `openNew` to:

```ts
    const openNew = () => {
        if (docModule?.newPath) open({ kind: 'doc-form', target: { module: docModule.module, entity: docModule.entity, recordId: null, mode: 'create' }, title: docModule.newLabel ?? 'New', path: docModule.newPath, unique: true });
    };
```

- [ ] **Step 2: Render the "New" button only when `newPath` exists**

Replace the New-button JSX:

```tsx
                    <button className="workbench-doc-tab workbench-doc-tab-new" onClick={openNew} title={docModule.newLabel}>
                        <Plus size={16} />
                        {docModule.newLabel}
                    </button>
```

with:

```tsx
                    {docModule.newPath && (
                        <button className="workbench-doc-tab workbench-doc-tab-new" onClick={openNew} title={docModule.newLabel}>
                            <Plus size={16} />
                            {docModule.newLabel}
                        </button>
                    )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors; `newLabel`/`newPath` are now optional in `DOC_MODULES`).

- [ ] **Step 4: Run the existing workspace tests**

Run: `npx vitest run src/stores/workspace src/components/workspace`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/TwoLevelTabBar.tsx
git commit -m "feat(workspace): hide second-row New button for modules without a newPath"
```

---

## Task 3: Open the Reports catalog tab on navigation to /reports

**Files:**
- Modify: `src/components/workspace/WorkspaceShell.tsx`

- [ ] **Step 1: Add the `/reports` handler**

In `src/components/workspace/WorkspaceShell.tsx`, inside the location effect, add this block immediately **before** the final fallback `const pm = pageModuleForPath(path); setPageModuleTab(...)`:

```ts
        if (path === '/reports') {
            open({ kind: 'list', target: { module: 'reports', entity: 'catalog', recordId: 'catalog', mode: 'view' }, title: 'Reports', path: '/reports' });
            return;
        }
```

(`/reports/bank-reconciliation` is not matched here, so it falls through to the page-module fallback and keeps rendering the standalone `BankReconciliation` view via `<Outlet/>`.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/WorkspaceShell.tsx
git commit -m "feat(workspace): open Reports catalog tab from /reports navigation"
```

---

## Task 4: Add the `variant` prop and gate the catalog / active-report regions in Reports.tsx

**Files:**
- Modify: `src/views/reports/Reports.tsx`

This task adds the prop surface and the catalog behaviour. Single-report behaviour is wired in Task 5.

- [ ] **Step 1: Define `ReportsProps` and accept the prop**

In `src/views/reports/Reports.tsx`, replace the component declaration:

```tsx
const Reports: React.FC = () => {
```

with:

```tsx
export interface ReportsProps {
  /** 'legacy' (default): standalone-route behaviour — internal tab strip + "Laporan Lainnya".
   *  'catalog': render only the category sidebar + cards; running a report calls onRunReport.
   *  'single': render exactly one report (singleReport/singleParams); no catalog, no other-report cards. */
  variant?: 'legacy' | 'catalog' | 'single';
  /** catalog: called when the user runs a report from the parameter modal. */
  onRunReport?: (report: ReportDefinition, params: ReportParams) => void;
  /** single: the report to display and its run parameters. */
  singleReport?: ReportDefinition;
  singleParams?: ReportParams;
  /** single: called when the user re-runs via "Ubah Filter", to persist new params. */
  onParamsChange?: (params: ReportParams) => void;
}

const Reports: React.FC<ReportsProps> = ({
  variant = 'legacy',
  onRunReport,
  singleReport,
  singleParams,
  onParamsChange,
}) => {
```

- [ ] **Step 2: Add visibility flags after `activeReport` is computed**

Immediately after the line `const activeReport = openReports.find((entry) => entry.report.id === activeReportId) || null;` (line 1307), add:

```tsx
  const showCategorySidebar = variant !== 'single';
  const showCatalog = variant === 'legacy' || variant === 'catalog';
  const showInternalTabs = variant === 'legacy';
  const showOtherReports = variant === 'legacy';
```

- [ ] **Step 3: Branch the run action for the `catalog` variant**

In `handleRunReport`, replace the success block that sets internal state. Find:

```tsx
      const params = buildRequestParams(reportToRun);
      setReportPresets((prev) => ({
        ...prev,
        [reportToRun.id]: params,
      }));
```

Immediately after that `setReportPresets(...)` call, add the catalog short-circuit (before the `const data = await api.get(...)` line):

```tsx
      if (variant === 'catalog') {
        onRunReport?.(reportToRun, params);
        return;
      }
```

(For `catalog`, the report tab does the fetch — this just hands the params to the workspace.)

- [ ] **Step 4: Persist params on re-run for the `single` variant**

In `handleRunReport`, right after the catalog short-circuit added in Step 3, add:

```tsx
      if (variant === 'single') {
        onParamsChange?.(params);
      }
```

(The `single` fetch is driven by the effect added in Task 5; this records the new params upward, which re-renders this component with new `singleParams`.)

- [ ] **Step 5: Gate the outer category sidebar**

Wrap the left sidebar `<div>` (lines 3074–3092, the `w-[200px] shrink-0 …` block) in `showCategorySidebar`:

```tsx
      {showCategorySidebar && (
        <div className="w-[200px] shrink-0 border-r border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-1 overflow-y-auto">
          {/* …existing category buttons unchanged… */}
        </div>
      )}
```

- [ ] **Step 6: Make the main content render in single mode and gate the cards grid**

The main content is currently gated by `{categoryReports.length > 0 && (`. Replace that opening guard (line 3095) with one that also allows single mode:

```tsx
        {(variant === 'single' || categoryReports.length > 0) && (
```

Wrap the search header (the `<div className="flex items-center justify-between mb-5">` block, lines 3097–3109) in `showCatalog`:

```tsx
            {showCatalog && (
              <div className="flex items-center justify-between mb-5">
                {/* …existing title + search input unchanged… */}
              </div>
            )}
```

Change the cards-grid guard (line 3111) from `{!activeReport && !isLoading && (` to:

```tsx
            {showCatalog && !activeReport && !isLoading && (
```

Change the "no matching reports" empty-state guard (line 3119) from `{!activeReport && !isLoading && !filteredReports.length && (` to:

```tsx
            {showCatalog && !activeReport && !isLoading && !filteredReports.length && (
```

- [ ] **Step 7: Gate the internal tab strip and "Laporan Lainnya"**

Change the internal tab-strip guard (line 3133) from `{openReports.length > 0 && !isLoading && (` to:

```tsx
            {showInternalTabs && openReports.length > 0 && !isLoading && (
```

Wrap the entire "Laporan Lainnya" block (lines 3242–3253, the `<div className="mt-8 pt-6 border-t …">`) in `showOtherReports`:

```tsx
                {showOtherReports && (
                  <div className="mt-8 pt-6 border-t border-neutral-200 print:hidden">
                    {/* …existing Laporan Lainnya content unchanged… */}
                  </div>
                )}
```

- [ ] **Step 8: Hide the internal "Tutup" (close) button in single mode**

In the active-report header, the "Tutup" button (lines 3173–3181) clears internal state, which would blank a workspace report tab. Wrap it so it only shows in legacy mode. Replace the button + its trailing divider:

```tsx
                      {variant === 'legacy' && (
                        <>
                          <button
                            onClick={() => {
                              closeReportTab(activeReport.report.id);
                              setError(null);
                            }}
                            className="flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900"
                          >
                            <X size={14} /> Tutup
                          </button>
                          <div className="h-4 w-px bg-neutral-300" />
                        </>
                      )}
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`onRunReport`, `onParamsChange`, `singleReport`, `singleParams` are referenced; `singleReport`/`singleParams` are used by the effect in Task 5 — until then they're typed but unused, which `tsc --noEmit` allows for props.)

- [ ] **Step 10: Run unit tests**

Run: `npm test`
Expected: PASS (legacy behaviour unchanged; default `variant='legacy'`).

- [ ] **Step 11: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): add variant prop, gate catalog vs single regions"
```

---

## Task 5: Single-report fetch-on-mount + report lookup helper

**Files:**
- Modify: `src/views/reports/Reports.tsx`

- [ ] **Step 1: Export a report lookup helper**

In `src/views/reports/Reports.tsx`, immediately after the `REPORTS_BY_CATEGORY` definition (around line 863), add:

```tsx
/** Flat list of every report definition, for looking a report up by id. */
export const ALL_REPORTS: ReportDefinition[] = Object.values(REPORTS_BY_CATEGORY).flat() as ReportDefinition[];

/** Find a report definition by its id (used by the workspace report tab). */
export function findReportById(id: string | undefined | null): ReportDefinition | undefined {
  if (!id) return undefined;
  return ALL_REPORTS.find((r) => r.id === id);
}
```

- [ ] **Step 2: Add the single-mode fetch/prompt effect**

In the component body, after `handleRunReport` is defined (after line 1538) add:

```tsx
  // `single` variant: fetch the one report from its saved params on mount and
  // whenever the params change (e.g. after "Ubah Filter"). With no saved params
  // yet (a fresh/deep-linked report tab), open the parameter modal to collect them.
  const singleParamsKey = singleParams ? JSON.stringify(singleParams) : '';
  useEffect(() => {
    if (variant !== 'single' || !singleReport) return;
    if (!singleParams) {
      openParamModal(singleReport);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.get<Record<string, unknown>>(
          singleReport.apiPath,
          singleParams as unknown as Record<string, unknown>,
        );
        if (cancelled) return;
        const entry: OpenReportEntry = {
          report: singleReport,
          data,
          params: singleParams,
          dateFrom: singleParams.dateFrom ?? null,
          dateTo: singleParams.dateTo ?? null,
          asOfDate: singleParams.asOfDate ?? null,
        };
        setOpenReports([entry]);
        setActiveReportId(singleReport.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, singleReport, singleParamsKey]);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (all props now consumed).

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): single-variant fetch-on-mount + findReportById helper"
```

---

## Task 6: Workspace wrapper components + tabRegistry wiring

**Files:**
- Create: `src/components/workspace/ReportsCatalogTab.tsx`
- Create: `src/components/workspace/ReportsReportTab.tsx`
- Modify: `src/components/workspace/tabRegistry.tsx`

- [ ] **Step 1: Create the catalog wrapper**

Create `src/components/workspace/ReportsCatalogTab.tsx`:

```tsx
import React from 'react';
import Reports, { type ReportDefinition, type ReportParams } from '../../views/reports/Reports';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { makeTabId } from '../../stores/workspace/types';

/** The Reports module's catalog tab: renders the card grid, and opens each
 *  chosen report as its own `report` sub-tab carrying the run params. */
const ReportsCatalogTab: React.FC = () => {
  const { open } = useWorkspaceNav();
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);

  const handleRun = (report: ReportDefinition, params: ReportParams) => {
    const target = { module: 'reports', entity: report.id, recordId: null, mode: 'view' as const };
    const opened = open({ kind: 'report', target, title: report.name, path: '/reports' });
    if (opened) saveDraft(makeTabId(target), params);
  };

  return <Reports variant="catalog" onRunReport={handleRun} />;
};

export default ReportsCatalogTab;
```

- [ ] **Step 2: Create the single-report wrapper**

Create `src/components/workspace/ReportsReportTab.tsx`:

```tsx
import React from 'react';
import Reports, { findReportById, type ReportParams } from '../../views/reports/Reports';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

/** A single open report, rendered from the params stashed on its workspace tab
 *  draft. "Ubah Filter" persists new params back to the same tab. */
const ReportsReportTab: React.FC<{ tabId: string }> = ({ tabId }) => {
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId));
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);
  const report = findReportById(tab?.target.entity);
  const params = (tab?.draft as ReportParams | undefined) ?? undefined;

  if (!report) {
    return <div className="p-6 text-sm text-neutral-500">Unknown report.</div>;
  }

  return (
    <Reports
      variant="single"
      singleReport={report}
      singleParams={params}
      onParamsChange={(p) => saveDraft(tabId, p)}
    />
  );
};

export default ReportsReportTab;
```

- [ ] **Step 3: Wire the registry**

In `src/components/workspace/tabRegistry.tsx`, add the imports near the other component imports (top of file):

```tsx
import ReportsCatalogTab from './ReportsCatalogTab';
import ReportsReportTab from './ReportsReportTab';
```

Inside `renderTab`, add this branch immediately before the final fallback `return (<div className="p-6 …">`:

```tsx
    if (module === 'reports') {
        if (tab.kind === 'list') return <ReportsCatalogTab />;
        if (tab.kind === 'report') return <ReportsReportTab tabId={tab.id} />;
    }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/ReportsCatalogTab.tsx src/components/workspace/ReportsReportTab.tsx src/components/workspace/tabRegistry.tsx
git commit -m "feat(workspace): render Reports catalog + report sub-tabs"
```

---

## Task 7: End-to-end test + manual verification

**Files:**
- Create: `e2e/workspace-reports.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `e2e/workspace-reports.spec.ts`:

```ts
// e2e/workspace-reports.spec.ts
//
// Reports migrated to per-document workspace tabs: a second row with the
// catalog button but NO "New" button, and choosing a report opens it as its
// own `report` sub-tab. Requires the dev server started with
// VITE_WORKSPACE_TABS=1 and the backend running.
import { test, expect } from '@playwright/test';

type Bridge = { __MSM_WORKSPACE__: { tabs: Array<{ kind: string; target: { module: string; entity: string } }> } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('msm-workspace'); } catch { /* ignore */ } });
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@demo.com');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
});

test('Reports is a document module with a catalog row but no New button', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.locator('.workbench-doc-tab-catalog')).toBeVisible();
  await expect(page.locator('.workbench-doc-tab-new')).toHaveCount(0);
});

test('running a report opens it as a report sub-tab', async ({ page }) => {
  await page.goto('/reports');
  // Open the first report card → parameter modal → run with defaults.
  await page.getByRole('button', { name: /Cash Flow/ }).first().click();
  await page.getByRole('button', { name: /^(Tampilkan|Jalankan|Run|Lihat)/ }).click();
  await page.waitForFunction(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.some((t) => t.kind === 'report' && t.target.module === 'reports'));
  const hasReportTab = await page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.some((t) => t.kind === 'report' && t.target.module === 'reports'));
  expect(hasReportTab).toBe(true);
});
```

Note: confirm the parameter modal's run-button label in `Reports.tsx` (the `<Modal>` footer near line 3600) and adjust the `name:` regex in the second test to match it exactly.

- [ ] **Step 2: Run the e2e spec**

Run: `VITE_WORKSPACE_TABS=1 npm run test:e2e -- workspace-reports.spec.ts`
Expected: PASS (Playwright config starts the dev server; backend must be running on its usual port).

- [ ] **Step 3: Run the full existing e2e workspace suite for regressions**

Run: `VITE_WORKSPACE_TABS=1 npm run test:e2e -- workspace-doc-modules.spec.ts workspace.spec.ts workspace-tabux.spec.ts`
Expected: PASS (no regressions in the previously-migrated modules).

- [ ] **Step 4: Manual preview check**

Start the dev server with `VITE_WORKSPACE_TABS=1`, then via the preview tools:
1. Open `/reports` — confirm a second tab row with the catalog (list) button and no "New (+)".
2. Click a report card, pick a period, run — confirm a new sub-tab appears named after the report, showing only that report (no "Laporan Lainnya" cards beneath it).
3. Open a second report — confirm it becomes a second sub-tab and both stay open.
4. Click "Ubah Filter", change the date range, run — confirm the same tab updates in place.
5. Toggle the flag off (`VITE_WORKSPACE_TABS` unset) and load `/reports` — confirm the legacy view (internal tabs + "Laporan Lainnya") still works unchanged.

- [ ] **Step 5: Final full verification**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/workspace-reports.spec.ts
git commit -m "test(workspace): e2e for Reports as a document module"
```

---

## Self-review notes

- **Spec coverage:** Reports → document module (Tasks 1, 3, 6); second-row sub-tabs with no New button (Tasks 1, 2); catalog tab = card grid (Tasks 4, 6); single-report view without "Laporan Lainnya" (Tasks 4, 5); params via tab `draft`/`saveDraft` (Tasks 5, 6); legacy route reuses the same component unchanged (Task 4, `variant='legacy'` default). All PR-1 spec items map to a task.
- **Type consistency:** `ReportsProps` (Task 4) is consumed identically by both wrappers (Task 6); `findReportById`/`ALL_REPORTS` defined in Task 5 and imported in Task 6; `DOC_MODULES` optional `newLabel`/`newPath` (Task 1) matches the guarded usage in `TwoLevelTabBar` (Task 2).
- **Out of scope (PR 2):** the three Cash & Bank reports, the `bank-period` filter mode, and the journal drill-down land in the next plan.
```
