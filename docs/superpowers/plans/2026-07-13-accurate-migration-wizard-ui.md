# Accurate Migration — Wizard UI Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided, full-page migration wizard that lets an admin onboard an Accurate Online company — upload exports, map columns, stage, reconcile, commit, and roll back — driven entirely by the Plan 1 `/api/v1/migration/*` routes.

**Architecture:** A single-component step state machine (mirroring `src/components/ar/invoices/ImportInvoicesModal.tsx`) rendered full-page as a new **tab in `src/views/tools/DataTools.tsx`**, gated by a build-time flag `VITE_MIGRATION_WIZARD` (default off) and the `settings` permission module. Steps 1–5 (the seven master-data + opening-balance uploads) share ONE reusable `EntityStageStep` (upload → auto-guess column mapping with editable dropdowns → preview/validate → stage). Bespoke steps: Start, Reconcile, Commit, Done. Spreadsheet parsing reuses the SheetJS helpers in `src/utils/shopeeImport.ts`; a new `useMigration` hook family calls the API via the `api` client with React-Query invalidation.

**Tech Stack:** React + Vite, react-router, @tanstack/react-query, SheetJS (`xlsx`), shared primitives in `src/components/UI/` (`Button`, `Modal`, `Tabs`, `Card`, `Table`, `SearchableSelect`, `Input`), Vitest for unit tests, the in-app Browser preview for visual verification.

**Design source:** `docs/superpowers/specs/2026-07-13-accurate-migration-onboarding-design.md` (flow Steps 0–8). UI decisions (approved 2026-07-13): full-page panel in Data & Tools; auto-guess + editable column dropdowns; `VITE_MIGRATION_WIZARD` flag default off.

---

## Background the engineer needs

- **The API (Plan 1, merged in PR #105).** All under `/api/v1/migration/batches`:
  - `POST /` `{ cutoverDate }` → creates a DRAFT batch, returns the batch (`{ id, status, cutoverDate, stagedData, ... }`).
  - `GET /` → list batches.
  - `GET /:id` → one batch (404 if missing).
  - `POST /:id/stage` `{ entity, rows }` → validates + stages; returns `{ staged: number, errors: {row,message}[] }`. `entity` ∈ `accounts | customers | vendors | items | opening-journal | opening-invoices | opening-bills`.
  - `GET /:id/reconcile` → `{ ok: boolean, checks: { id, label, expected, actual, pass }[] }`.
  - `POST /:id/commit` → `{ committed: boolean, reconcile }` (HTTP 200 even when `committed=false`).
  - `POST /:id/rollback` → `{ rolledBack: boolean, reason?: string }`.
- **Row shapes the `rows` array must contain** (must match Plan 1 Zod schemas in `lib/migration/schemas.ts`): accounts `{code,name,type,parentCode?}`; customers/vendors `{name,email?,phone?,address?,npwp?}`; items `{name,sku?,type?,unit?,salePrice?,purchasePrice?,openingStock?,openingValue?}`; opening-journal `{accountCode,debit?,credit?}`; opening-invoices `{customerName,invoiceNumber?,issueDate,dueDate?,amount}`; opening-bills `{vendorName,billNumber?,issueDate,dueDate?,amount}`. Dates are `YYYY-MM-DD` strings.
- **API client:** `src/api/apiClient.ts` `api.get/post(path, body)` — attaches auth + `x-active-org`, throws `Error` with `.status` on non-2xx. All paths start `/api/v1/…`.
- **xlsx parsing to reuse:** `src/utils/shopeeImport.ts` — `import * as XLSX from 'xlsx'`, `file.arrayBuffer()` → `XLSX.read(buf,{type:'array'})` → `XLSX.utils.sheet_to_json(sheet,{header:1})` gives rows-as-arrays (first row = headers). Reuse `parseNum` (Indonesian `1.500.000`) and `parseDateCell` (Date/serial/string → Date) from that file; and `normalizeHeader` from `src/utils/headerUtils.ts`. Do NOT reuse the Shopee-specific order logic.
- **Column auto-match precedent:** `resolveHeaders`/`COLUMN_SPECS` alias-table pattern in `shopeeImport.ts` — copy the alias-matching approach for the new entity field specs.
- **Placement:** `src/views/tools/DataTools.tsx` declares tabs in a `TOOL_ITEMS` array with the active tab in `?tab=`. Add a flag-gated entry.
- **Feature flag:** add to `src/config/featureFlags.ts` following `WORKSPACE_TABS_ENABLED = import.meta.env.VITE_WORKSPACE_TABS === '1'`.
- **RBAC in UI:** `useModulePermissions('settings')` → `{ canView, canCreate, ... }`. Gate the whole wizard on `canCreate`.
- **Primitives:** `src/components/UI/` (capital UI). No Stepper/Dropzone exists — build small local ones. Toasts: `useToastStore().pushToast(msg, 'success'|'error')`.
- **Testing reality:** the repo unit-tests pure logic and hooks with Vitest. Confirm whether `@testing-library/react` is available (grep `package.json`); if present, write component tests; if NOT, unit-test the pure utils + hooks and verify components via the Browser preview (documented per task). Do not add a new test framework.

## File structure

- Modify `src/config/featureFlags.ts` — add `MIGRATION_WIZARD_ENABLED`.
- Create `src/utils/migrationFields.ts` — per-entity target-field specs (field, label, required, aliases) — the single source of truth for auto-mapping, validation hints, and template download.
- Create `src/utils/migrationImport.ts` — `parseSpreadsheet(file) → { headers, rows }` (xlsx + csv) and `autoMapColumns(headers, entity) → Record<field, sourceHeader|null>` and `applyMapping(rows, headers, mapping, entity) → objectRows` (with number/date coercion via `parseNum`/`parseDateCell`).
- Create `src/hooks/useMigration.ts` — React-Query hooks for all 7 endpoints.
- Create `src/components/migration/FileDropzone.tsx` — reusable file input/dropzone.
- Create `src/components/migration/ColumnMapper.tsx` — target-field → source-column editable dropdowns (auto-filled).
- Create `src/components/migration/steps/EntityStageStep.tsx` — reusable upload→map→preview→stage for one entity.
- Create `src/components/migration/steps/StartStep.tsx`, `ReconcileStep.tsx`, `CommitStep.tsx`, `DoneStep.tsx`.
- Create `src/components/migration/MigrationWizard.tsx` — the shell + step state machine + batch state.
- Modify `src/views/tools/DataTools.tsx` — add the flag-gated tab rendering `<MigrationWizard/>`.
- Tests: `src/utils/__tests__/migrationImport.test.ts`, `src/utils/__tests__/migrationFields.test.ts`, `src/hooks/__tests__/useMigration.test.ts` (+ component tests only if testing-library exists).

---

## Task 1: Feature flag + flag-gated placeholder tab

**Files:**
- Modify: `src/config/featureFlags.ts`
- Modify: `src/views/tools/DataTools.tsx`
- Test: none (wiring only; verified via preview)

- [ ] **Step 1: Add the flag**

In `src/config/featureFlags.ts`, mirroring the existing `WORKSPACE_TABS_ENABLED`:

```ts
export const MIGRATION_WIZARD_ENABLED = import.meta.env.VITE_MIGRATION_WIZARD === '1';
```

- [ ] **Step 2: Add a flag-gated tab to DataTools**

Read `src/views/tools/DataTools.tsx` to see the exact `TOOL_ITEMS` shape and how tab content is switched. Add — only when `MIGRATION_WIZARD_ENABLED` — a `{ id: 'migration', label: 'Migration Wizard', icon: <appropriate icon> }` entry, and in the content switch render a placeholder for now: `{activeTab === 'migration' && <div>Migration wizard coming soon</div>}`. Keep the existing tabs untouched.

- [ ] **Step 3: Verify via preview**

Start the dev server (preview_start with the app's launch config), set `VITE_MIGRATION_WIZARD=1` in the dev env, navigate to `/tools?tab=migration`, and confirm the new tab shows the placeholder. With the flag unset, confirm the tab is absent. Screenshot both.

- [ ] **Step 4: Commit**

```bash
git add src/config/featureFlags.ts src/views/tools/DataTools.tsx
git commit -m "feat(migration-ui): flag-gated Migration Wizard tab placeholder"
```

---

## Task 2: Entity field specs

**Files:**
- Create: `src/utils/migrationFields.ts`
- Test: `src/utils/__tests__/migrationFields.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ENTITY_FIELDS, requiredFields, type MigrationEntity } from '../migrationFields';

describe('ENTITY_FIELDS', () => {
  it('covers all 7 migration entities', () => {
    const keys = Object.keys(ENTITY_FIELDS) as MigrationEntity[];
    expect(keys.sort()).toEqual([
      'accounts', 'customers', 'items', 'opening-bills', 'opening-invoices', 'opening-journal', 'vendors',
    ]);
  });
  it('marks account code/name/type as required and parentCode optional', () => {
    const req = requiredFields('accounts');
    expect(req).toContain('code'); expect(req).toContain('name'); expect(req).toContain('type');
    expect(req).not.toContain('parentCode');
  });
  it('gives each field at least one alias including itself (normalized)', () => {
    for (const spec of ENTITY_FIELDS.customers) {
      expect(spec.aliases.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/utils/__tests__/migrationFields.test.ts` → module not found.

- [ ] **Step 3: Implement**

Create `src/utils/migrationFields.ts`. Define `MigrationEntity` (same 7 strings as the API), a `FieldSpec = { field: string; label: string; required: boolean; aliases: string[] }`, and `ENTITY_FIELDS: Record<MigrationEntity, FieldSpec[]>` matching the Plan 1 row shapes (see Background). Aliases are lower-cased header variants an Accurate export might use (English + Bahasa), e.g. accounts `code` aliases `['code','account code','no akun','kode akun','no. akun']`; `type` aliases `['type','account type','tipe','tipe akun']`; customers `name` aliases `['name','customer name','nama','nama pelanggan']`; opening-journal `debit`/`credit` aliases `['debit','debet']` / `['credit','kredit']`; opening-invoices `amount` aliases `['amount','balance','outstanding','sisa','saldo']`, `issueDate` aliases `['date','issue date','tanggal','tgl']`. Export `requiredFields(entity) = ENTITY_FIELDS[entity].filter(f=>f.required).map(f=>f.field)`.

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/migrationFields.ts src/utils/__tests__/migrationFields.test.ts
git commit -m "feat(migration-ui): per-entity target field specs + aliases"
```

---

## Task 3: Spreadsheet parse + column mapping utils

**Files:**
- Create: `src/utils/migrationImport.ts`
- Test: `src/utils/__tests__/migrationImport.test.ts`

- [ ] **Step 1: Write the failing test** (test the pure functions with in-memory data — no real File needed for mapping/apply)

```ts
import { describe, it, expect } from 'vitest';
import { autoMapColumns, applyMapping } from '../migrationImport';

describe('autoMapColumns', () => {
  it('matches headers to fields by alias, case/space-insensitive', () => {
    const headers = ['Kode Akun', 'Nama', 'Tipe', 'Induk'];
    const map = autoMapColumns(headers, 'accounts');
    expect(map.code).toBe('Kode Akun');
    expect(map.name).toBe('Nama');
    expect(map.type).toBe('Tipe');
  });
  it('leaves unmatched target fields null', () => {
    const map = autoMapColumns(['Foo', 'Bar'], 'customers');
    expect(map.name).toBeNull();
  });
});

describe('applyMapping', () => {
  it('builds object rows using the mapping and coerces numbers/dates', () => {
    const headers = ['Account Code', 'Debit', 'Credit'];
    const rows = [['1-1200', '10.000.000', '0']];
    const mapping = { accountCode: 'Account Code', debit: 'Debit', credit: 'Credit' };
    const out = applyMapping(rows, headers, mapping, 'opening-journal');
    expect(out[0]).toMatchObject({ accountCode: '1-1200', debit: 10000000, credit: 0 });
  });
  it('formats date fields to YYYY-MM-DD', () => {
    const out = applyMapping(
      [['PT Andi', '2025-12-01', '5.000.000']],
      ['Customer', 'Date', 'Amount'],
      { customerName: 'Customer', issueDate: 'Date', amount: 'Amount' },
      'opening-invoices',
    );
    expect(out[0].issueDate).toBe('2025-12-01');
    expect(out[0].amount).toBe(5000000);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement**

Create `src/utils/migrationImport.ts`:
- `export async function parseSpreadsheet(file: File): Promise<{ headers: string[]; rows: (string|number)[][] }>` — if the name ends `.csv`, read text and split (reuse `CsvImportPanel`'s `parseCsvText` approach); else `XLSX.read(await file.arrayBuffer(), {type:'array'})` → first sheet → `XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })`; headers = first row (strings), rows = the rest.
- `export function autoMapColumns(headers: string[], entity: MigrationEntity): Record<string, string|null>` — for each `FieldSpec` in `ENTITY_FIELDS[entity]`, find the first header whose `normalizeHeader` matches any alias (normalized); return `{ field: header|null }`.
- `export function applyMapping(rows, headers, mapping, entity): Record<string, unknown>[]` — for each row, for each mapped field read the source cell by header index; coerce numeric fields (those whose spec label implies number: debit/credit/amount/salePrice/purchasePrice/openingStock/openingValue) via `parseNum`, and date fields (issueDate/dueDate) via `parseDateCell` then format `YYYY-MM-DD`; leave others as trimmed strings. Skip fully-empty rows.

Import `parseNum`, `parseDateCell` from `../utils/shopeeImport` (or wherever they're exported — confirm) and `normalizeHeader` from `../utils/headerUtils`. Add a local `toYmd(date: Date): string`.

- [ ] **Step 4: Run to verify it passes** — PASS. Also add a tiny test that `parseSpreadsheet` on a real generated `.csv` File (use `new File([csvText], 'x.csv')`) returns the right headers/rows.

- [ ] **Step 5: Commit**

```bash
git add src/utils/migrationImport.ts src/utils/__tests__/migrationImport.test.ts
git commit -m "feat(migration-ui): spreadsheet parse + auto column mapping utils"
```

---

## Task 4: useMigration React-Query hooks

**Files:**
- Create: `src/hooks/useMigration.ts`
- Test: `src/hooks/__tests__/useMigration.test.ts`

- [ ] **Step 1: Write the failing test** (mock the `api` client; render hooks with a QueryClient wrapper — follow the pattern in an existing `src/hooks/__tests__/*` test; if none exist, test the mutationFns by importing the raw request functions)

Structure the hook file so the raw request functions are exported and unit-testable without rendering, e.g. `export const migrationApi = { create, get, list, stage, reconcile, commit, rollback }`. Test:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/api/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from '@/api/apiClient';
import { migrationApi } from '../useMigration';

beforeEach(() => vi.clearAllMocks());

describe('migrationApi', () => {
  it('create posts cutoverDate', async () => {
    (api.post as any).mockResolvedValue({ id: 'b1', status: 'DRAFT' });
    const r = await migrationApi.create('2026-01-01');
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches', { cutoverDate: '2026-01-01' });
    expect(r.id).toBe('b1');
  });
  it('stage posts entity + rows to the batch', async () => {
    (api.post as any).mockResolvedValue({ staged: 2, errors: [] });
    await migrationApi.stage('b1', 'customers', [{ name: 'A' }, { name: 'B' }]);
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches/b1/stage', { entity: 'customers', rows: [{ name: 'A' }, { name: 'B' }] });
  });
  it('reconcile GETs the checks', async () => {
    (api.get as any).mockResolvedValue({ ok: true, checks: [] });
    await migrationApi.reconcile('b1');
    expect(api.get).toHaveBeenCalledWith('/api/v1/migration/batches/b1/reconcile');
  });
  it('commit and rollback POST to their endpoints', async () => {
    (api.post as any).mockResolvedValue({});
    await migrationApi.commit('b1'); await migrationApi.rollback('b1');
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches/b1/commit', {});
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches/b1/rollback', {});
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement**

Create `src/hooks/useMigration.ts`. Export `migrationApi` with the raw functions (paths above). Then export React-Query hooks wrapping them: `useCreateBatch()`, `useBatch(id)` (`useQuery`, enabled when id), `useBatches()`, `useStageEntity(id)`, `useReconcile(id)` (`useQuery`, `enabled:false` or manual `refetch`), `useCommitBatch(id)`, `useRollbackBatch(id)` — each mutation `onSuccess` invalidates the batch query key. Use a `MIGRATION_KEYS` object like other hooks.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMigration.ts src/hooks/__tests__/useMigration.test.ts
git commit -m "feat(migration-ui): useMigration React-Query hooks"
```

---

## Task 5: FileDropzone + ColumnMapper components

**Files:**
- Create: `src/components/migration/FileDropzone.tsx`
- Create: `src/components/migration/ColumnMapper.tsx`
- Test: component tests only if `@testing-library/react` is present (grep package.json); else verify in Task 10 preview.

- [ ] **Step 1: Implement `FileDropzone`**

Props: `{ onFile: (file: File) => void; accept?: string; label?: string }`. A `border-2 border-dashed` div with a hidden `<input type="file" accept={accept}>`, click-to-browse + drag-over highlight (copy the inline dropzone markup used in `ImportInvoicesModal`/`CsvImportPanel`). Show the selected filename.

- [ ] **Step 2: Implement `ColumnMapper`**

Props: `{ headers: string[]; entity: MigrationEntity; mapping: Record<string,string|null>; onChange: (field: string, header: string|null) => void }`. For each `FieldSpec` in `ENTITY_FIELDS[entity]`, render a row: label (with a required asterisk), and a `SearchableSelect` (from `src/components/UI/`) whose options are the `headers` (plus a "— none —" option), value = `mapping[field]`. Required fields with no mapping render a red hint. Pure presentational — no fetching.

- [ ] **Step 3: If testing-library exists, write a render test** that ColumnMapper shows one row per field and calls `onChange` when a select changes. Otherwise note "verified in Task 10 preview".

- [ ] **Step 4: Commit**

```bash
git add src/components/migration/FileDropzone.tsx src/components/migration/ColumnMapper.tsx
git commit -m "feat(migration-ui): reusable FileDropzone + ColumnMapper"
```

---

## Task 6: EntityStageStep (reusable upload → map → preview → stage)

**Files:**
- Create: `src/components/migration/steps/EntityStageStep.tsx`

- [ ] **Step 1: Implement**

Props: `{ batchId: string; entity: MigrationEntity; title: string; onStaged: (result: {staged:number; errors:{row:number;message:string}[]}) => void; onSkip?: () => void }`. Internal sub-state: `'upload' | 'map' | 'preview'`.
- **upload:** `<FileDropzone>` → `parseSpreadsheet(file)` → store `{headers, rows}`, run `autoMapColumns(headers, entity)` into `mapping`, go to `map`. Also a "Download template" link (build CSV from `ENTITY_FIELDS[entity]` headers) and, where relevant, a "Skip this step" button calling `onSkip`.
- **map:** `<ColumnMapper headers entity mapping onChange>`; "Next" disabled until all required fields mapped.
- **preview:** compute `applyMapping(rows, headers, mapping, entity)`, show the first ~20 object rows in a `Table`, with a client-side required-field check surfaced as row warnings; "Stage N rows" button calls `useStageEntity(batchId).mutate({entity, rows})`, then `onStaged(result)` (show `result.errors` if any). Use `pushToast` for success/failure.

Keep this component focused; it is reused for all 7 entities.

- [ ] **Step 2: Verify** — no unit test (integration-heavy); it is exercised in Task 10's preview run. If testing-library exists, add a light test that a mapped upload calls the stage mutation with object rows.

- [ ] **Step 3: Commit**

```bash
git add src/components/migration/steps/EntityStageStep.tsx
git commit -m "feat(migration-ui): reusable EntityStageStep (upload/map/preview/stage)"
```

---

## Task 7: Start step + wizard shell

**Files:**
- Create: `src/components/migration/steps/StartStep.tsx`
- Create: `src/components/migration/MigrationWizard.tsx`

- [ ] **Step 1: Implement `StartStep`**

Props: `{ onCreated: (batch) => void }`. Shows the current org name (read from the org/auth store — confirm the store), a cutover-date `<Input type="date">` (required), and a "Start migration" button → `useCreateBatch().mutate({cutoverDate})` → `onCreated(batch)`. Include a short explanatory paragraph (clean-cutover, opening balances as of this date).

- [ ] **Step 2: Implement `MigrationWizard` shell**

The state machine (mirror `ImportInvoicesModal`): `type Step = 'start'|'accounts'|'customers'|'vendors'|'items'|'opening-journal'|'opening-invoices'|'opening-bills'|'reconcile'|'commit'|'done'`; a `STEPS: Step[]` array; `const [step,setStep]=useState('start')`; `const [batch,setBatch]=useState(null)`. A left rail or top progress strip shows step titles with the current one highlighted and completed ones checked. Gate the whole component on `useModulePermissions('settings').canCreate` (else render a "no permission" notice). Body switches on `step`:
- `start` → `<StartStep onCreated={b => { setBatch(b); setStep('accounts'); }} />`
- each entity step → `<EntityStageStep batchId={batch.id} entity=... title=... onStaged={() => setStep(next)} onSkip={() => setStep(next)} />`
- `reconcile` / `commit` / `done` → the Task 8/9 components.
Steps are gated in order (can't reach reconcile without a batch). Provide Back where safe (master-data steps), but NOT backward across commit.

- [ ] **Step 3: Verify** — rendered in Task 10 preview.

- [ ] **Step 4: Commit**

```bash
git add src/components/migration/steps/StartStep.tsx src/components/migration/MigrationWizard.tsx
git commit -m "feat(migration-ui): wizard shell + start step"
```

---

## Task 8: Reconcile step (renders checks, gates commit)

**Files:**
- Create: `src/components/migration/steps/ReconcileStep.tsx`

- [ ] **Step 1: Implement**

Props: `{ batchId: string; onProceed: () => void; onBack: () => void }`. On mount, `useReconcile(batchId)` (fetch/refetch). Render the four `checks` as rows: label, expected, actual, and a green ✓ / red ✗ per `pass` (format money with the app's existing number formatter — find it, e.g. `formatCurrency`). Show an overall banner. The "Continue to commit" button is **disabled unless `data.ok === true`**; when red, show guidance ("open AR total doesn't match the AR control account — fix your staged data"). Provide a "Re-check" button (refetch) and "Back" to fix staged entities.

- [ ] **Step 2: Verify** — preview (Task 10) with both a balanced and an unbalanced dataset; confirm the button disables when any check fails.

- [ ] **Step 3: Commit**

```bash
git add src/components/migration/steps/ReconcileStep.tsx
git commit -m "feat(migration-ui): reconcile step with commit gating"
```

---

## Task 9: Commit + Done steps (TB verification + rollback)

**Files:**
- Create: `src/components/migration/steps/CommitStep.tsx`
- Create: `src/components/migration/steps/DoneStep.tsx`

- [ ] **Step 1: Implement `CommitStep`**

Props: `{ batchId: string; onCommitted: (result) => void; onBack: () => void }`. A confirm screen ("This posts opening balances to your live books as of <cutover>. You can roll this back until you record new transactions."). "Commit migration" → `useCommitBatch(batchId).mutate()`. If `result.committed === false`, show the failed `result.reconcile.checks` inline and a "Back to fix" button (do NOT advance). If `committed === true`, call `onCommitted(result)`. Show a spinner while pending.

- [ ] **Step 2: Implement `DoneStep`**

Props: `{ batch; onRolledBack: () => void }`. Show a success summary from `batch.summary` (counts). **TB verification:** fetch the live Trial Balance as-of the cutover date via the existing report endpoint (`GET /api/v1/reports/gl?type=trial-balance&asOfDate=<cutover>` — confirm the exact query params against `src/app/api/v1/reports/gl/route.ts`) and show the AR/AP/Inventory control rows so the user sees the books now hold the opening balances. A **"Roll back this migration"** button → confirm dialog → `useRollbackBatch(batch.id).mutate()`; on `{rolledBack:false}` show `reason` as an error toast; on success call `onRolledBack()` and reset the wizard to `start`.

- [ ] **Step 3: Verify** — preview (Task 10): full commit path shows the summary + TB rows; rollback empties and returns to start; rollback-blocked shows the reason.

- [ ] **Step 4: Commit**

```bash
git add src/components/migration/steps/CommitStep.tsx src/components/migration/steps/DoneStep.tsx
git commit -m "feat(migration-ui): commit + done steps with TB verification and rollback"
```

---

## Task 10: Wire the wizard into DataTools + end-to-end preview verification

**Files:**
- Modify: `src/views/tools/DataTools.tsx` (replace the Task 1 placeholder with `<MigrationWizard/>`)

- [ ] **Step 1: Replace the placeholder**

In the `migration` tab content, render `<MigrationWizard />` (keep it flag-gated).

- [ ] **Step 2: End-to-end preview run (the real verification for this plan)**

With `VITE_MIGRATION_WIZARD=1` and both dev servers running, and a test org that has the bootstrap COA (so AR/AP/Inventory/Opening-Equity defaults exist), drive the full flow in the Browser preview:
1. `/tools?tab=migration` → Start: pick a cutover date → start batch.
2. Stage a tiny balanced dataset by uploading small CSVs for accounts (optional), customers, vendors, items (with opening stock), opening-journal (balanced TB), opening-invoices, opening-bills — mapping columns via the auto-guess dropdowns.
3. Reconcile: confirm all four checks are green and the Continue button enables. Then deliberately break one file (e.g. wrong AR total) and confirm a red check disables Continue.
4. Commit: confirm success; Done shows the summary and the live Trial Balance control rows matching the imported TB.
5. Roll back: confirm the company is emptied and the wizard returns to Start.
Capture screenshots of Reconcile (green + red) and Done. Check console/network for errors (`read_console_messages`, `read_network_requests`).

- [ ] **Step 3: Full front-end test sweep**

Run: `npm test` (all unit tests incl. the new migration util/hook tests) → green. `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/views/tools/DataTools.tsx
git commit -m "feat(migration-ui): wire MigrationWizard into Data & Tools tab"
```

---

## Deployment note

Pure front-end; no schema or migration changes. Gated by `VITE_MIGRATION_WIZARD` (set `=1` to enable per deployment). Depends on the Plan 1 API (PR #105) being deployed.

## Known limitation carried from Plan 1

If a user records real, non-journal activity referencing migrated masters after cutover and then tries to roll back, the API can surface a raw error rather than a clean "blocked" message. The Done step's rollback handler should show the API's `reason` when present and fall back to a generic "rollback failed — the books may already be in use" message on an unexpected error, so the UI degrades gracefully.
