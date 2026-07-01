# Cash & Bank Reports — Design

Date: 2026-06-29
Module: Reports → Cash & Bank
Status: Approved design, pending implementation plan

## Goal

Add three new reports under **Reports → Cash & Bank**, and first migrate the Reports
module into the PR#88 workspace tab system so opened reports appear as Accurate-style
second-row sub-tabs.

The three reports:

1. **Bank History** (Mutasi Bank) — every bank movement over a chosen period, passbook
   style with a running balance. Optional bank filter (defaults to all banks).
2. **Detail Received per Bank** — money received by a chosen bank over a chosen period.
   Income **plus** incoming transfers.
3. **Detail Payment per Bank** — money paid out of a chosen bank over a chosen period.
   Expense **plus** outgoing transfers.

Every row in all three reports shows the **journal number** as a link; clicking it opens
that transaction's own document form in the Banking module (Payment / Receive / Transfer).

## Sequencing (two PRs)

- **PR 1 — Reports workspace migration.** Migrate the whole Reports module into the
  workspace two-level tab system: each opened report becomes a second-row sub-tab, the card
  grid becomes the module's catalog tab, and the single-report view drops the "Laporan
  Lainnya" bottom cards. Affects all 24 existing reports.
- **PR 2 — Cash & Bank reports.** Add the three new reports (cards, backend, rendering,
  journal drill-down) into the migrated structure.

## Decisions (from brainstorming)

- **Transfers are included.** Received = Income + incoming transfers (`toBankAccountId` = the
  bank). Payment = Expense + outgoing transfers (`bankAccountId` = the bank). A transfer
  between two own accounts appears as money-out of the source bank and money-in to the
  destination bank — consistent with a real bank book.
- **Bank History is passbook style** with opening balance, per-row running balance, and
  closing balance.
- **Bank History bank filter is optional** (default "All banks"). With all banks selected,
  each bank renders as its own passbook section (its own opening → closing); balances are not
  interleaved across accounts.
- **Journal-number drill-down opens the bank transaction form** (the editable Payment /
  Receive / Transfer document), not the raw GL journal voucher.
- **Reports open as workspace sub-tabs**, one per report; the card grid is a catalog tab; the
  single-report view shows only that report (no other-report cards beneath it).

---

## PR 1 — Reports workspace migration

Today `/reports` is registered as a **page module** (`PAGE_MODULES` in
`src/stores/workspace/modules.ts`), so it renders as a single `<Outlet/>` screen and uses
`Reports.tsx`'s own internal tab state (`openReports` / `activeReportId`) — which is also what
renders the "Laporan Lainnya" bottom cards. The migration turns Reports into a **document
module** so the workspace renders a second tab row for it.

### Workspace registration (`src/stores/workspace/modules.ts`)

- Add `reports` to `DOC_MODULE_TITLES` (title "Reports") and `DOC_MODULES`
  (`{ module: 'reports', entity: 'catalog', title: 'Reports', listPath: '/reports' }`, with
  **no** `newLabel` / `newPath` — Reports has no "new document").
- `moduleKeyOf`: map `t.module === 'reports'` → `'reports'` so every report tab (whatever its
  entity) groups under the one Reports module.
- Remove the `/reports` entry from `PAGE_MODULES`.

### Tab bar (`src/components/workspace/TwoLevelTabBar.tsx`)

- Render the second-row **New (+)** button only when the active doc module defines a
  `newPath`. Reports (no `newPath`) shows just the catalog button + its report sub-tabs.

### Sidebar / nav (`src/components/workspace/WorkspaceShell.tsx`)

- Add a Reports handler that opens the catalog tab
  (`open({ kind: 'list', target: { module: 'reports', entity: 'catalog', recordId: 'catalog', mode: 'view' }, title: 'Reports', path: '/reports' })`),
  matching the existing per-module handlers.

### Tab rendering (`src/components/workspace/tabRegistry.tsx`)

- Add a `module === 'reports'` branch:
  - `kind === 'list'` → `<ReportCatalog />` (category sidebar + search + card grid).
  - `kind === 'report'` → `<ReportView tabId={tab.id} />` (one report run).

### Component split (refactor `src/views/reports/Reports.tsx`)

- **`ReportCatalog`** — the category sidebar, search, and card grid. Clicking a card opens a
  report sub-tab: `open({ kind: 'report', target: { module: 'reports', entity: reportId, recordId: null, mode: 'view' }, title: reportName, path: '/reports/<id>' })`. One tab per
  report type (re-opening focuses the existing tab).
- **`ReportView`** — renders a single report: the filter-summary header, "Ubah Filter", the
  report body, and Print / Export CSV / Export PDF. **No "Laporan Lainnya" cards.** On first
  render with no saved params it shows the parameter modal; on submit it stashes params via
  the store's `saveDraft(tabId, params)` and fetches. "Ubah Filter" reopens the modal and
  updates the draft. The report-body rendering and CSV builders move into a shared module
  imported by `ReportView`.
- The legacy `/reports` route (workspace flag off) keeps working by rendering the same
  `ReportCatalog` / report-body components, so there is one rendering path, not two.

### Params transport

- A report run's parameters (type, date range, bank, etc.) live in the workspace tab's
  `draft` field via `saveDraft`. `ReportView` reads `tab.draft` to fetch and render, so a
  report tab survives tab switches (keep-alive) and shows its own filters.

---

## PR 2 — Cash & Bank reports

### Data model (no migration needed)

All required fields already exist.

- `BankTransaction`: `id`, `number`, `bankAccountId`, `date`, `description`, `amount`,
  `type` (`INCOME | EXPENSE | TRANSFER`), `reference`, `payee`, `receivedFrom`,
  `toBankAccountId`, `journalEntryId`.
- `BankAccount`: `id`, `name`, `code`, `bankName`, `openingBalance`, `currentBalance`,
  `isActive`.
- `JournalEntry`: `entryNo` (the displayed journal number), linked via `journalEntryId`.

#### Sign convention (per account X)

| Transaction | Condition | Effect on X |
| --- | --- | --- |
| INCOME | `bankAccountId = X` | money **in** (+) |
| EXPENSE | `bankAccountId = X` | money **out** (−) |
| TRANSFER (out) | `bankAccountId = X` | money **out** (−) |
| TRANSFER (in) | `toBankAccountId = X` | money **in** (+) |

### Backend (`src/app/api/v1/reports/banking/route.ts`)

Extend the existing route (already `withPermission({ module: 'REPORTS', action: 'view' })`)
with three new `type` branches. Mirror the `startOfDay` / `endOfDay` helpers from the GL
report route. Build an `id → { name }` map of the org's bank accounts once per request to
resolve transfer counterparty names (`toBankAccountId` has no Prisma relation).

Common per-row fields: `bankTransactionId`, `type`, `journalEntryNo` (`entryNo` or `null`),
`txnNumber`, `date`, `description`, `reference`.

- **`type=bank-history`** — scope = the given `bankAccountId` or all active accounts. Per
  account: `openingBalance = account.openingBalance + Σ signed(txns touching it before
  dateFrom)`; in-range rows sorted by `date` then `createdAt`, each with `moneyIn`,
  `moneyOut`, `runningBalance`; plus `totalIn`, `totalOut`, `closingBalance`. Response:
  `{ banks: [{ bankAccountId, bankAccountName, bankName, accountCode, openingBalance, rows, totalIn, totalOut, closingBalance }], summary: { totalIn, totalOut, netChange } }`. A transfer
  between two in-scope accounts yields a row in each section.
- **`type=bank-received`** (requires `bankAccountId`) — rows in range AND
  `((INCOME AND bankAccountId = X) OR (TRANSFER AND toBankAccountId = X))`; each adds
  `from` (`receivedFrom` or source bank name) and `amount`. Response:
  `{ rows, summary: { count, totalReceived }, bankAccount: { id, name } }`.
- **`type=bank-payment`** (requires `bankAccountId`) — rows in range AND
  `((EXPENSE AND bankAccountId = X) OR (TRANSFER AND bankAccountId = X))`; each adds
  `payee` (`payee` or destination bank name) and `amount`. Response:
  `{ rows, summary: { count, totalPaid }, bankAccount: { id, name } }`.

### Frontend (catalog cards + report view)

- Add three `ReportDefinition`s to `BANKING_REPORTS`, all `category: 'banking'`,
  `apiPath: '/api/v1/reports/banking'`, `type: 'table'`, `filterMode: 'bank-period'`:
  `bank-history` (`bankRequired: false`), `bank-received` (`bankRequired: true`),
  `bank-payment` (`bankRequired: true`).
- New filter mode **`bank-period`**: extend the `FilterMode` union, add optional
  `bankRequired?: boolean` to `ReportDefinition`, and add `bankAccountId?: string` to
  `ReportParams`. The parameter modal renders a date-range pair plus a bank
  `SearchableSelect` (load via `useBankAccounts()`); "All banks" allowed only when
  `bankRequired` is false, otherwise a bank must be chosen before running.
- Render branches in the shared report body:
  - `bank-history`: one passbook block per `banks[]` entry (header, opening row, rows with
    running balance, totals/closing row).
  - `bank-received` / `bank-payment`: a flat table plus a totals row.
  - Columns per the approved mockup (History: Date / Journal no. / Description / In / Out /
    Balance; Received: Date / Journal no. / From / Description / Amount; Payment: Date /
    Journal no. / Payee / Description / Amount).
- **Journal-number drill-down**: render `journalEntryNo` (fallback `txnNumber`) as a link;
  on click `navigate(\`/banking/${pathByType[type]}?txnId=${bankTransactionId}\`)` with
  `pathByType` = `{ INCOME: 'receive', EXPENSE: 'payment', TRANSFER: 'transfer' }`, mirroring
  Banking.tsx. The Banking view's `useDocumentTabs({ urlParam: 'txnId' })` opens the matching
  form pre-loaded.
- **Export & print**: add a `buildBankingCsv(report, data)` builder (Indonesian headers,
  consistent with the other reports), including the journal number, opening / closing /
  running balances and per-bank totals for history and totals for received / payment; ensure
  the three render inside the existing `react-to-print` printable area.

---

## Testing

PR 1:

- Unit/interaction: opening a report from the catalog creates a `kind: 'report'` sub-tab;
  re-opening the same report focuses the existing tab; the single-report view renders no
  other-report cards; `saveDraft` round-trips report params; the New (+) button is hidden for
  Reports. Existing report-rendering tests continue to pass.

PR 2 — backend cases in `src/app/api/v1/__tests__/reports.test.ts`:

- `bank-history`: opening balance = account opening + prior-period movements; running balance
  correctness; a transfer appears in both source and destination sections; `bankAccountId`
  scoping; summary totals.
- `bank-received`: includes income and incoming transfers, excludes expense and outgoing
  transfers; correct `count` and `totalReceived`.
- `bank-payment`: includes expense and outgoing transfers, excludes income and incoming
  transfers; correct `count` and `totalPaid`.

## Out of scope

- No schema migration (all fields already exist).
- No new RBAC key — the existing `REPORTS / view` permission covers the new types.
- No change to how bank transactions are created or posted.
- No change to the legacy (workspace-flag-off) routing behaviour beyond reusing the extracted
  catalog / report-body components.
