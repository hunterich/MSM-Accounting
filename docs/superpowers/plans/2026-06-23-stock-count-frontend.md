# Stock Count — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Stock Counts UI on top of the completed `/stock-counts` API — a workbench (list + ＋New + open tabs like Sales Invoices), a count worksheet form, a review screen, and a posted-detail with Summary / Journal Entry (Dr/Cr) / Lines tabs.

**Architecture:** Mirror the **Banking workbench** (`DocumentTabBar` + `useDocumentTabs` + an inline conditional detail with local `detailTab` tabs) for the list/detail, and a **`FormPage` route** (like `AdjustmentForm`) for the count worksheet. React Query hooks in `useInventory.ts`. One backend addition: a `/stock-counts/[id]/journal` endpoint (the journal is resolved by memo, like bills).

**Tech Stack:** React 19, React Router 7, React Query v5, Tailwind v4, the shared UI kit (`DocumentTabBar`, `ListPage`, `PageHeader`, `FormPage`, `Table`, `StatusTag`, `Button`, `SearchableSelect`, `JournalDetailModal`).

**Spec:** `docs/superpowers/specs/2026-06-23-stock-count-design.md`
**Branch:** `feat/stock-count` (backend + spec already committed here).

**Verification note:** UI changes are verified in the browser preview (two dev servers: frontend 5173, backend 3000). `npm run typecheck` is the per-task gate; a manual preview walkthrough is the final gate (Task 6).

**RBAC decision:** reuse the existing **`inv_adj`** permission key for nav + routes — adding a new `inv_counts` key would require a backend role-seed change. No new permission.

**StatusTag mapping (the app has no `posted`/`submitted` key):** Draft → `status="draft"`; Submitted → `status="Warning" label="Submitted"`; Posted → `status="Success" label="Posted"`; Cancelled → `status="Error" label="Cancelled"`. Define this helper once at the top of **both** `StockCounts.tsx` and `StockCountForm.tsx` (it's tiny — duplicate it rather than adding a shared file), used as `<StatusTag {...countStatusTag(status)} />`:
```ts
function countStatusTag(status: string): { status: string; label: string } {
  switch (status) {
    case 'POSTED':    return { status: 'Success', label: 'Posted' };
    case 'SUBMITTED': return { status: 'Warning', label: 'Submitted' };
    case 'CANCELLED': return { status: 'Error',   label: 'Cancelled' };
    default:          return { status: 'draft',   label: 'Draft' };
  }
}
```

---

## File Structure

| File | Change |
|---|---|
| `src/app/api/v1/stock-counts/[id]/journal/route.ts` | **New.** Resolve the generated adjustment's `JournalEntry` (by memo) → `JournalDetail` |
| `src/hooks/useInventory.ts` | Add `INV_KEYS.counts/count/countJournal`, `useStockCounts`, `useStockCount`, `useStockCountJournal`, and create/update/submit/reopen/post/cancel mutations |
| `src/components/Layout/Sidebar.tsx` | Add **Stock Counts** to the Inventory nav group |
| `src/stores/useAccessStore.ts` | Map `/inventory/counts` → `inv_adj` in `SUBITEM_PERMISSION_MAP` |
| `src/App.tsx` | Lazy-import + routes for `/inventory/counts`, `/counts/new`, `/counts/edit` |
| `src/views/inventory/StockCounts.tsx` | **New.** Workbench list + inline posted/review detail (Summary/Journal/Lines tabs) |
| `src/views/inventory/StockCountForm.tsx` | **New.** Count worksheet (create/seed + edit counts + ＋Add item) + submit/reopen/post/cancel |

---

## Task 1: Backend journal endpoint

The posted-detail Journal Entry tab needs the generated adjustment's Dr/Cr lines. `postStockAdjustmentToLedger` writes the JE with memo `` `Stock adjustment: ${number}` `` (a single net JE — net increase OR net decrease), and the codebase resolves journals **by memo** (no source FK). So: count → `generatedAdjustmentId` → adjustment number → `JournalEntry` by memo.

**Files:**
- Create: `src/app/api/v1/stock-counts/[id]/journal/route.ts`

- [ ] **Step 1: Create the route** (mirrors `src/app/api/v1/bills/[id]/journal/route.ts`):

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;

  const count = await prisma.stockCount.findFirst({
    where: { id, organizationId: orgId },
    select: { generatedAdjustmentId: true },
  });
  if (!count) return err('Stock count not found', 404);
  if (!count.generatedAdjustmentId) return ok(null); // not posted, or posted with no variance

  const adj = await prisma.stockAdjustment.findFirst({
    where: { id: count.generatedAdjustmentId, organizationId: orgId },
    select: { number: true },
  });
  if (!adj) return ok(null);

  const entry = await prisma.journalEntry.findFirst({
    where: { organizationId: orgId, memo: `Stock adjustment: ${adj.number}`, status: 'POSTED' },
    orderBy: { postedAt: 'desc' },
    include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, name: true } } } } },
  });
  if (!entry) return ok(null);

  return ok({
    id: entry.id,
    entryNo: entry.entryNo,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    totalDebit: Number(entry.totalDebit),
    totalCredit: Number(entry.totalCredit),
    lines: entry.lines.map((l) => ({
      lineNo: l.lineNo,
      accountCode: l.account?.code ?? '',
      accountName: l.account?.name ?? '',
      description: l.description ?? '',
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  });
}
```

(If the `bills/[id]/journal` route's field names for `JournalEntry`/`JournalLine` differ — e.g. `entryNo` vs `number`, `debit`/`credit` types — match THAT route exactly; it is the source of truth for the shape.)

- [ ] **Step 2: Verify against an existing posted count**

Run: `npm run typecheck` → clean. Then, with both dev servers up, post a count (or use one created in Task 6) and `curl -s -H "x-org-id: <org>" http://localhost:3000/api/v1/stock-counts/<id>/journal` → returns a balanced `{ totalDebit, totalCredit, lines }` for a posted count, or `null` for a draft/no-variance count.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/stock-counts/[id]/journal/route.ts
git commit -m "feat(stock-count): GET /stock-counts/[id]/journal (resolve generated adjustment's JE)"
```

---

## Task 2: React Query hooks

**Files:**
- Modify: `src/hooks/useInventory.ts`

- [ ] **Step 1: Add the query keys**

In the `INV_KEYS` object (`useInventory.ts:11`), add:
```ts
    counts:       ['invStockCounts'] as const,
    count:        (id: string) => ['invStockCounts', id] as const,
    countJournal: (id: string) => ['invStockCounts', id, 'journal'] as const,
```

- [ ] **Step 2: Add the hooks** (append near the other inventory hooks):

```ts
export interface StockCountLineRow {
  id: string; lineNo: number; itemId: string;
  systemQty: number; countedQty: number | null; unitCost: number; note: string | null;
  liveSystemQty?: number; changedSinceCount?: boolean;
  item?: { id: string; name: string; sku: string };
}
export interface StockCount {
  id: string; number: string; date: string; status: string;
  warehouseId: string | null; categoryId: string | null; countedBy: string | null;
  notes: string | null; generatedAdjustmentId: string | null;
  lines?: StockCountLineRow[]; _count?: { lines: number };
}

export function useStockCounts(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: [...INV_KEYS.counts, filters],
    queryFn: () => api.get<ListResponse<StockCount>>('/api/v1/stock-counts', filters),
    staleTime: 15_000,
  });
}

export function useStockCount(id: string | undefined) {
  return useQuery({
    queryKey: INV_KEYS.count(id ?? ''),
    queryFn: () => api.get<StockCount>(`/api/v1/stock-counts/${id}`),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useStockCountJournal(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: INV_KEYS.countJournal(id ?? ''),
    queryFn: () => api.get<import('./useAP').JournalDetail | null>(`/api/v1/stock-counts/${id}/journal`),
    enabled: Boolean(id) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; warehouseId?: string; categoryId?: string; countedBy?: string; notes?: string }) =>
      api.post<StockCount>('/api/v1/stock-counts', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.counts }),
  });
}

export function useUpdateStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; notes?: string; countedBy?: string; lines?: Array<{ itemId: string; countedQty?: number | null; note?: string }> }) =>
      api.put<StockCount>(`/api/v1/stock-counts/${id}`, body),
    onSuccess: (_d, { id }) => { qc.invalidateQueries({ queryKey: INV_KEYS.count(id) }); qc.invalidateQueries({ queryKey: INV_KEYS.counts }); },
  });
}

function countAction(action: 'submit' | 'reopen' | 'post' | 'cancel') {
  return function useCountAction() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => api.post<StockCount>(`/api/v1/stock-counts/${id}/${action}`, {}),
      onSuccess: (_d, id) => {
        qc.invalidateQueries({ queryKey: INV_KEYS.count(id) });
        qc.invalidateQueries({ queryKey: INV_KEYS.counts });
        if (action === 'post') { qc.invalidateQueries({ queryKey: INV_KEYS.items }); qc.invalidateQueries({ queryKey: INV_KEYS.adjustments }); qc.invalidateQueries({ queryKey: INV_KEYS.countJournal(id) }); }
      },
    });
  };
}
export const useSubmitStockCount = countAction('submit');
export const useReopenStockCount = countAction('reopen');
export const usePostStockCount   = countAction('post');
export const useCancelStockCount = countAction('cancel');
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` → clean (confirm `ListResponse` + `JournalDetail` import paths resolve; `JournalDetail` is exported from `src/hooks/useAP.ts`).
```bash
git add src/hooks/useInventory.ts
git commit -m "feat(stock-count): React Query hooks (list/detail/journal + lifecycle mutations)"
```

---

## Task 3: Nav + RBAC + routes

**Files:**
- Modify: `src/components/Layout/Sidebar.tsx`, `src/stores/useAccessStore.ts`, `src/App.tsx`

- [ ] **Step 1: Nav item**

In `src/components/Layout/Sidebar.tsx`: add `ClipboardCheck` to the `lucide-react` import (top of file). In the Inventory `NAV_GROUPS` entry, add **between** Item Categories and Stock Adjustments:
```ts
            { label: 'Stock Counts',     path: '/inventory/counts',      icon: ClipboardCheck },
```

- [ ] **Step 2: RBAC path**

In `src/stores/useAccessStore.ts`, in `SUBITEM_PERMISSION_MAP`, after `'/inventory/adjustments': 'inv_adj',` add:
```ts
    '/inventory/counts':       'inv_adj',
```

- [ ] **Step 3: Routes**

In `src/App.tsx`: add lazy imports near the other inventory views (~line 52):
```tsx
const StockCounts = lazy(() => import('./views/inventory/StockCounts'))
const StockCountForm = lazy(() => import('./views/inventory/StockCountForm'))
```
And in the inventory `<Route>` block (after `inventory/adjustments/edit`):
```tsx
                    <Route path="inventory/counts" element={withPermission(<StockCounts />, 'inv_adj')} />
                    <Route path="inventory/counts/new" element={withPermission(<StockCountForm />, 'inv_adj', 'create')} />
                    <Route path="inventory/counts/edit" element={withPermission(<StockCountForm />, 'inv_adj', 'edit')} />
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck` → clean.
```bash
git add src/components/Layout/Sidebar.tsx src/stores/useAccessStore.ts src/App.tsx
git commit -m "feat(stock-count): nav item + route + RBAC wiring (inv_adj)"
```

---

## Task 4: Count worksheet form (`StockCountForm.tsx`)

This is the create/seed + edit screen, a `FormPage` route reading `?id=&mode=view|edit` (mirror `src/views/inventory/AdjustmentForm.tsx` for the route-param + FormPage + line-table conventions; use `SearchableSelect` for ＋Add item).

**Files:**
- Create: `src/views/inventory/StockCountForm.tsx`

- [ ] **Step 1: Implement the form**

Behavior contract (build it with these exact pieces; mirror AdjustmentForm's structure):
- **Mode:** `const adjId = searchParams.get('id'); const mode = searchParams.get('mode') === 'view' ? 'view' : id ? 'edit' : 'new'`.
- **New mode (no id):** a small create panel — Date (`Input type=date`), Category (`SearchableSelect` over `useItemCategories()`, optional), Warehouse (`SearchableSelect` over `useWarehouses()`, optional), Counted by (`Input`), Notes (`textarea`) — and a **"Create count"** primary button calling `useCreateStockCount().mutateAsync({ date, categoryId, warehouseId, countedBy, notes })`, then `navigate(\`/inventory/counts/edit?id=${created.id}\`)` to land on the seeded worksheet.
- **Edit mode (id present):** `const { data: count } = useStockCount(id)`. Render the worksheet:
  - Header: `count.number`, date, `countStatusTag(count.status)`, scope chips (category/warehouse/countedBy), and a progress line `` `${counted} of ${count.lines.length} items counted` `` where `counted = lines.filter(l => l.countedQty != null).length`.
  - Local editable state seeded from `count.lines`: `const [rows, setRows] = useState(() => count.lines.map(l => ({ itemId, name, sku, systemQty, countedQty, note })))` (reset via `useEffect` when `count` loads).
  - Table columns: **Item** (name + sku), **System qty** (read-only, right), **Counted** (`<input type=number>` → updates `rows[i].countedQty`; blank = null), **Variance** (computed `countedQty == null ? '—' : countedQty - systemQty`, colored: `>0` success-700 `#2b8a3e`, `<0` danger-700 `#c92a2a`, `0` neutral), **Note** (`<input>` → `rows[i].note`). Disable inputs when `mode === 'view'` or `count.status !== 'DRAFT'`.
  - **＋ Add item row:** a `SearchableSelect` over `useItems()` (`options = items.map(i => ({ value: i.id, label: i.name, subLabel: i.sku }))`), excluding itemIds already in `rows`; on select, append a row with `systemQty = item.currentStock`, `countedQty = null`.
  - **Actions** depend on status:
    - `DRAFT`: **Save draft** (`useUpdateStockCount().mutateAsync({ id, notes, countedBy, lines: rows.map(r => ({ itemId: r.itemId, countedQty: r.countedQty, note: r.note })) })`) and **Submit for review** (save first, then `useSubmitStockCount().mutateAsync(id)`). Also **Cancel** (`useCancelStockCount`).
    - `SUBMITTED` (review): read-only counts; show a **"⚠ system changed since count"** chip on rows where `line.changedSinceCount`; **Reopen** (`useReopenStockCount`), **Cancel**, **Post** (`usePostStockCount().mutateAsync(id)` → on success `navigate('/inventory/counts?countId=' + id)` to view the posted detail).
    - `POSTED`/`CANCELLED`: fully read-only; a link "View in workbench" → `/inventory/counts?countId=${id}`.
  - Wrap in `<FormPage title="Stock Count" backTo="/inventory/counts" backLabel="Back to Stock Counts" isLoading={isLoading} actions={…}>`.
- Permissions: `const { canCreate, canEdit } = useModulePermissions('inv_adj')` — gate Save/Submit/Post.

- [ ] **Step 2: Typecheck + preview-verify**

Run: `npm run typecheck` → clean. With dev servers up + logged in, go to `/inventory/counts/new`, create a count (category scope), confirm it lands on the seeded worksheet with system quantities; enter a few counts + a note; Save draft; Submit. Confirm the variance colors and the progress counter.

- [ ] **Step 3: Commit**

```bash
git add src/views/inventory/StockCountForm.tsx
git commit -m "feat(stock-count): count worksheet form (seed, count, add-item, submit/post)"
```

---

## Task 5: Workbench list + posted/review detail (`StockCounts.tsx`)

Mirror `src/views/banking/Banking.tsx` exactly for the workbench shell: `useDocumentTabs({ urlParam: 'countId' })` + `DocumentTabBar` (Catalog + "＋ New count" → `navigate('/inventory/counts/new')`) + a conditional `{!selected && <list/>}` / `{selected && <detail/>}`.

**Files:**
- Create: `src/views/inventory/StockCounts.tsx`

- [ ] **Step 1: Implement the workbench**

- **Data:** `const { data: countsRes, isLoading } = useStockCounts()`; `const counts = countsRes?.data ?? []`. Tabs: `const { selectedId, openIds, openTab, closeTab, selectNone, tabRows } = useDocumentTabs({ urlParam: 'countId' })`. `const selected = counts.find(c => c.id === selectedId)`; when a tab is open, fetch full detail via `useStockCount(selectedId)` for lines + journal.
- **Tab bar:** `<DocumentTabBar openIds selectedId tabRows getLabel={(id) => counts.find(c=>c.id===id)?.number ?? id} onSelect={openTab} onClose={closeTab} newTabLabel="New count" onNewTab={() => navigate('/inventory/counts/new')} disableNew={!canCreate} onCatalog={selectNone} firstRowSuffix={<div className="workbench-tab-count">Open tabs: {openIds.length}</div>} />`.
- **List (`!selected`):** filters (search by number, status `<select>`), then `<Table columns data={filtered} onRowClick={(row) => openTab(row.id)} showCount countLabel="counts" isLoading={isLoading} />`. Columns: Number, Date (`formatDateID`), Scope (category/warehouse names or "All"), Status (`<StatusTag {...countStatusTag(row.status)} />`), Items (`row._count?.lines`), and a row-action **Open worksheet** → `navigate(\`/inventory/counts/edit?id=${row.id}\`)` (DRAFT/SUBMITTED) or just open the tab (POSTED).
- **Detail (`selected`):** an `invoice-workbench-card dense-mode` block (copy Banking's structure, lines 353-447): topbar with `selected.number` + `<StatusTag {...countStatusTag(selected.status)} />`, then `detail-tabs dense-tabs` with `const [detailTab, setDetailTab] = useState('summary')` toggling **Summary | Journal Entry | Lines**:
  - **Summary:** count meta (date, scope, counted-by, notes), a variance summary (`# items counted`, `# up / # down`), and — for non-POSTED — a button **"Open worksheet"** → `/inventory/counts/edit?id=${selected.id}`.
  - **Lines:** `<Table>` of the detail lines (Item, System qty, Counted, Variance) from `useStockCount(selectedId).data.lines`.
  - **Journal Entry:** `const journal = useStockCountJournal(selectedId, detailTab === 'journal' && selected.status === 'POSTED')`. Render the Dr/Cr table by **reusing the `JournalDetailModal` table markup inline** (or render `<JournalDetailModal isOpen onClose journal={journal.data} isLoading={journal.isLoading} />` as a modal opened from a button). Prefer an inline `Account | Debit | Credit` table (mirror `src/components/UI/JournalDetailModal.tsx` lines 42-69) with a Total footer; when `journal.data` is null show "Posted with no variance — no journal entry." plus the link to the generated adjustment (`/inventory/adjustments/edit?id=${selected.generatedAdjustmentId}&mode=view`).
- Permissions: `const { canCreate } = useModulePermissions('inv_adj')`.
- Page shell: `<div className="container banking-module container-full-width"><PageHeader title="Stock Counts" subtitle="Count physical stock and post the variances." /> …` (copy Banking's full-width shell, NOT `ListPage`).

- [ ] **Step 2: Typecheck + preview-verify**

Run: `npm run typecheck` → clean. In preview: `/inventory/counts` shows the list + ＋New count; open a posted count → the **Journal Entry** tab shows balanced Dr/Cr and a link to the generated adjustment; a draft count → "Open worksheet".

- [ ] **Step 3: Commit**

```bash
git add src/views/inventory/StockCounts.tsx
git commit -m "feat(stock-count): workbench list + posted/review detail with Journal Entry tab"
```

---

## Task 6: End-to-end preview verification

**Files:** none.

- [ ] **Step 1: Typecheck + unit/integration suites still green**

Run: `npm run typecheck` → clean. `npm test` → 287 pass. `npm run test:int` → 17 pass + 1 expected fail (unchanged — frontend doesn't touch the lib).

- [ ] **Step 2: Full browser walkthrough** (both dev servers up, logged in as `admin@demo.com`):
1. **Stock Counts** appears in the Inventory nav group → opens the workbench list.
2. **＋ New count** → create with a category scope → lands on the seeded worksheet showing system quantities.
3. Enter counts (one up, one down, one blank, a note) → **Save draft** → **Submit for review**.
4. Review screen: counts read-only, variance summary, **Post**.
5. After Post: on `/inventory/items`, the counted items' on-hand now equals what you counted; the workbench detail's **Journal Entry** tab shows the balanced Dr/Cr; the generated adjustment link opens the adjustment.
6. Re-open a posted count → fully read-only.

- [ ] **Step 3: Confirm branch state**

`git log --oneline main..HEAD` — spec + backend + frontend commits on `feat/stock-count`. `git status --short` shows only the user's untracked `scripts/backup-db.sh` / `RESTORE-GUIDE.md`.

---

## Notes for the implementer

- **Reuse, don't rebuild:** Banking.tsx is the workbench template; AdjustmentForm.tsx is the form template; JournalDetailModal.tsx is the Dr/Cr table; `useDocumentTabs`/`DocumentTabBar`/`StatusTag`/`SearchableSelect`/`Table`/`FormPage` are the primitives. The screens should be assembled from these, not hand-rolled.
- **`useDocumentTabs` does not sync selection→URL** beyond the initial read; `navigate('/inventory/counts?countId=' + id)` to deep-link the posted detail after Post.
- **`currentStock`** (from `normalizeItem`) seeds System Qty for ＋Add item.
- Do **not** add a new `inv_counts` permission key (would need a backend role seed) — reuse `inv_adj`.
- The count worksheet only **saves counts while DRAFT**; Submit/Reopen/Post/Cancel are status actions. The backend enforces all guards — surface its error messages.
