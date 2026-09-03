# Changelog — MSM Accounting Software

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### 🚑 Fixed — direct links to forms, and a chart of accounts that showed Rp 0 everywhere
- **A link straight to a "new document" form opened on "No open tabs".** The route→tab mapping in `WorkspaceShell` deliberately skipped `/ar/invoices/new`, `/ap/bills/new`, `/banking/payment` and the like, because the New button opens the tab itself and then syncs the URL — so a pasted link, a bookmark, or "open in new tab" landed nowhere (21 routes). `newDocumentTabForPath` now resolves those URLs to the same tab the button would open, or focuses the draft already open for that form; a link to `/ap/bills/edit` or `/ap/vendors/edit` with no record lands on the list. `/ar/delivery-notes/new` had no route at all and rendered a blank page
- **Every account on the Chart of Accounts read Rp 0,00.** The screen rolled up an empty balance map. New `GET /api/v1/accounts/balances` (guarded by GL_COA, so anyone who can see the chart sees the figures) returns net posted balances per account; the chart rolls them into headers and shows each on the account's normal side, so a liability with a credit balance reads positive. The CSV export carries the same figures

### 🚑 Fixed — five launch blockers from the pre-launch QA pass
- **The manual journal form could not save.** Every Post Entry / Save Draft was a bare 400: `buildJEPayload` sent the entry type in Title case (`Manual`) where the API enum is `MANUAL`, and `description: null` where the schema takes an optional string. The hook now maps the entry type both ways (so an existing entry also re-opens with the right option selected) and omits empty descriptions; the POST route returns the first zod message instead of "Invalid journal entry payload". `src/hooks/__tests__/useGL.test.ts` parses the hook's output with the server's own schema, so the two cannot drift apart silently again
- **The administrator was locked out of Fixed Assets, customer and vendor categories, POS settings and two reports.** The server bypasses the permission matrix for an ADMIN role; the client check did not, so any module without a matrix row was a 403 in the browser even though the API would serve it. `useAuthStore.hasPermission` now mirrors the server. The three client-only keys (`assets`, `ar_customer_categories`, `ap_vendor_categories`) that no role could ever hold now use the key the API guards those routes with (GL_JOURNAL, AR_CUSTOMERS, AP_VENDORS), and the admin role template covers `POS_RETAIL` / `POS_REPORTS`, which it had skipped
- **A new company could not add a customer or vendor from the UI.** Bootstrap created no categories, the forms required one, and the category screens were forbidden (above). Bootstrap now seeds an "Umum" customer / vendor / item category and a "Kas" cash register; the client no longer requires a category (the API never did — and the vendor form was validating a field it does not even hold, so vendor saves failed silently); a customer saved without a category still gets a `CST-nnnn` code
- **Paid invoices stayed "Sent" and paid bills stayed "Unpaid".** Outstanding amounts were always derived from allocations, but nothing wrote PAID back to the document, so a settled invoice kept its live Pay / Void buttons. `lib/settlement-status.ts` rolls COMPLETED-payment allocations (cash applied plus cash discount, the aging report's rule) up into `SalesInvoice.status` / `Bill.status`, called from payment create, update, approval finalize, void and POS sale; a voided receipt puts the document back to SENT / OPEN. A migration backfills documents that were already settled
- **Dashboard cash on hand never moved.** It summed the Banking register's cached `currentBalance`, which only bank-transaction screens update — an AR receipt or AP payment posts to the bank GL account and never touches the cache. `lib/cash-accounts.ts` reads the ledger instead (posted lines on the cash & bank accounts, found by name, report group or parent header), the same source the trial balance uses. The register's cached balance is unchanged and still drives bank reconciliation

### ✨ Added — Transaction-date restriction (Accurate "Pembatasan Tanggal Transaksi")
- **A window around today that documents must be dated within**, configured in Settings → Restrictions: N days before, N days after, either side optional. Separate from the monthly period lock — closing a month freezes it for good, while this catches a date that is merely implausible, like a mistyped year
- **Warn or block, per organization.** WARN shows the form banner and lets the save through; BLOCK refuses server-side with a 422, the same shape the period lock returns. Tightening this on a working team is not a flag-flip, so both exist
- **Enforced inside `assertPeriodOpen`**, which the policy gate below proves every journal-writing path reaches — so the window covers every posting path by construction rather than by hand. The period lock is reported first when a date breaks both rules: reopening a month is a different action from widening a window
- **Whoever holds SETTINGS/edit can post outside it** (`canOverrideTransactionDate`). Mapped onto that existing right rather than a new permission because it is the right that edits the window — someone who can widen it to anything is not restrained by it, and a separate flag would only add a second place to look. Automated paths (depreciation, recurring bills, payroll, settlement import, POS, marketplace) have no actor and stay held to the window; they post dated today
- **`src/lib/transaction-date-policy.ts`** is the single definition. The Settings screen, the API and the guard all read a stored policy through the same `parseTransactionDatePolicy`, and the API stores the parsed shape — so a policy cannot be saved in a state the guard would read differently

### 🚑 Fixed — four posting paths ignored the period lock
- **Opening stock on item create/update, the CSV opening-balance journal, the migration cutover journal, and marketplace settlement posting** all wrote POSTED journal entries without calling `assertPeriodOpen`. A closed month did not stop any of them. The migration cutover was the worst of the four: it is dated the cutover, which can be any past date, so it was the write most likely to land in a month already signed off
- The guard on opening stock sits **after** the `postGl` early return, so the migration path still imports its cost layers into a closed month — it writes no journal there, and there is nothing to guard

### ✨ Added — period-guard policy gate
- **`src/app/api/v1/__tests__/period-guard-policy.test.ts`** — a file that writes a journal entry must call `assertPeriodOpen`, or every non-test file that imports it must. The second clause lets a shared helper like `bill-posting.ts` stay clean while its five callers each guard, and fails the moment a sixth is added that does not; a file nothing imports (every route) has to guard itself, so coverage is never vacuous. Three documented exemptions: the shared writer `journal-posting.ts` (its callers guard, and it cannot guard unconditionally because the year-end close posts *into* the period it closes), `fiscal-year-close.ts` itself, and `pos/batch-stock-in.ts` (reachable only from the integration suite)
- It found the four gaps above. Like the dead-module gate, it is a ratchet rather than a proof — it matches text, so it cannot tell that a guard is on the right date, only that a posting path never mentions one


### 🚑 Fixed — screens that showed fixtures instead of the database
- **Sales orders never appeared in their own list.** `SOFormV2` saved to `/api/v1/sales-orders`, while the list and detail panes read a browser-local zustand store seeded with three fixtures ("Acme Corp", "Globex Inc"). Saving an order looked like it worked and then the order was nowhere. Both panes now read the API through `src/lib/salesOrderView.ts`, which maps the API's field names onto the ones the panes already render and derives the order total the same way `computeTotals` does — pinned by a test, so the list and the form can't show different numbers for the same order
- **Every printed bill and purchase order came out with an empty line table.** Both print previews pulled line items from a local fixture keyed by document id, and no real bill or PO id ever matched one of those keys. Both list endpoints have included their lines all along, so the printout is now the real document
- **Opening a saved employee showed an empty form.** The employee list links by the real record id; `EmployeeForm` looked that id up in a fixture store whose ids (`EMP-0001`) nothing in the database ever matched, so View and Edit both opened blank — and saving from that state would have written the blanks back. The form now loads through `useEmployee`, and `normalizeEmployee` carries the ten fields it was dropping (KTP, date of birth, employment type, bank details, NPWP, both BPJS numbers)
- **Department and position pickers were a hardcoded list of five and four strings**, with an "add" that persisted only in that browser. New `useDepartments` / `usePositions` hooks read the real tables; the API already creates either by name when an employee is saved with a new one
- **The employee form invented an employee number** (`EMP-nnnn`, computed from the fixtures) that the create route discarded — it assigns `employeeNo` itself
- **The sales-order list's date-range filters did nothing.** The panel has always offered From and To; nothing read them

### 🧹 Removed (dead code)
- **`src/data/mockData.js` and five zustand stores deleted (~1,700 lines)** — `useInvoiceStore`, `useBillStore`, `useSalesOrderStore`, `usePurchaseOrderStore`, `useHRStore`, the last of the pre-database client state layer. `src/data/` is now empty. The `module-reachability` gate added in the earlier cleanup caught the final orphan on its own

### 🧪 Testing
- **The e2e suite can be run twice without re-seeding.** `returns-to-ledger.spec.ts` asserted on whole-table counts ("the database starts with no credit notes") but created an applied credit note it could not remove — an applied note is deliberately immutable, and void reverses it with a second entry rather than deleting it. Its assertions now name what *this run* created. Two further assertions were unscoped in the same way: `choose()` matched `.cursor-pointer` across the whole page, so on a second run it grabbed a hidden catalog row carrying the same customer name instead of the dropdown option, and the total was matched anywhere on the page rather than in the form. The safety property the count guarded is structural anyway — `playwright.config.ts` forces the `_e2e` suffix onto whatever `DATABASE_URL` it is given


### ✨ Added — Closed-period warning on transaction forms
- **Transaction forms now say a date is in a closed period while it is being chosen**, instead of only after the save attempt. `ClosedPeriodBanner` is wired into the journal entry, invoice, bill, AR/AP payment, credit note, debit note, sales return, purchase return, banking (transfer / payment / receive) and inventory adjustment forms — every form whose date reaches `assertPeriodOpen`
- **`src/lib/periodLock.ts`** mirrors the server guard exactly (`startDate <= date <= endDate`, blocked on `CLOSED` **or** `isLocked`, a date outside every period is open). It warns, it does not block: the submit button stays enabled because the server is the real gate and a stale cached period list must never be able to stop a legitimate post. Backed by the same `['accounting-periods']` query Company Setup uses, so one fetch serves every open form and a close performed elsewhere shows up as soon as it invalidates

### 🚑 Fixed
- **The journal entry form's "Accounting Period" dropdown was fabricated** — a hardcoded four-month list (`2026-01` … `2026-04`) with January marked closed, validated against, and then dropped: `buildJEPayload` never sent it, so the choice reached nothing and the API resolved the period from the entry date regardless. A company whose fiscal year sat outside those four months had no selectable period at all, while a genuinely closed month was offered as open. The field is now a read-only display of the period the date actually resolves to, with its real status, and `journalEntryHeaderSchema` no longer requires a `period` the form does not collect

### ✨ Added — Fiscal-year close
- **Close and reopen a fiscal year** from Company Setup → Fiscal Year Close. Closing posts one journal entry (`source: CLOSING`, dated the last day of the year) that debits every revenue account by its credit balance, credits every expense account by its debit balance, and books the difference to Retained Earnings — so the next year starts from a clean P&L. Requires every month of the year to be closed first, which is what makes the balances final
- **Balances are the year's movements, not all-time**, so a second year closes on its own activity instead of sweeping up every year already closed. Covered by a test that closes two consecutive years
- **`retainedEarnings` account default** — resolves to `3-1000 Retained Earnings` on the standard chart, distinct from `openingBalanceEquity` (`3-9000`), and overridable in Settings → Account Defaults
- **New `FiscalYearClose` model** recording the year, its closing entry, and who closed it. Deliberately not an `AccountingPeriod` row: periods are monthly and the table forbids overlapping ranges, so a year-spanning period would collide with all twelve of its own months. `closingEntryId @unique` is the idempotency token — two concurrent closes race to insert and the loser gets a 409
- **Reopening deletes the closing entry** rather than reversing it, inside one transaction; the `FiscalYearClose` row cascades from the entry, so the lock and the entry cannot drift apart. The year's monthly periods stay closed — reopen those separately. The audit row keeps the deleted entry number and the previous closer
- **`POST /api/v1/fiscal-year/close`**, **`/reopen`**, and **`GET /close-preview`** — the preview drives the confirm modal *and* is re-checked by the close route, so the button can never offer a close the API refuses

### ✨ Added — Month-end close
- **Close and reopen a monthly accounting period** from Company Setup → Accounting Periods. Closing is what makes `assertPeriodOpen` start refusing any post, edit, or void dated inside the period; reopening lifts it again. Both are gated on SETTINGS/edit and take the same `FOR UPDATE` row lock the guard's `FOR SHARE` conflicts with, so a post can never slip through a half-closed period
- **A real close audit trail** — `AccountingPeriod.closedAt` / `closedById` (nullable, plus a `closedBy` relation), stamped on close and cleared on reopen, and shown in the period table. The reopen audit-log row carries `previouslyClosedById` so the trail survives the stamp being cleared
- **`POST /api/v1/accounting-periods/reopen`** — new route. **`POST /api/v1/accounting-periods/generate`** — backfills a fiscal year's twelve monthly periods from the same `buildFiscalYearPeriods` the company bootstrap uses. Idempotent: existing months are skipped by name *and* by date overlap, so re-running is safe
- **Pre-close checklist in the confirm step** — the existing `close-checklist` endpoint now drives the modal, showing unposted journals, unreconciled bank lines, pending approvals and overdue invoices before you commit

### 🚑 Fixed
- **The pre-close check never actually checked** — both the close route and the checklist counted unposted journals with `where periodId = <period>`, but `JournalEntry.periodId` is only populated when a client explicitly supplies it on a manual journal. Every automatic posting path (invoices on send, bills, payments, returns, depreciation, payroll) leaves it null, so the count was almost always 0 and a period could be closed straight over its unposted work. Membership is now resolved by **date**, the same rule `assertPeriodOpen` enforces on the write side (`lib/period-close.ts`)
- **Company Setup invented period statuses** — the table rendered twelve rows derived from `fiscalYearStart` and labelled any month before the current one "Closed", a claim the database never agreed with, while "Regenerate Periods" only rebuilt that fabricated list client-side. Both are replaced by real data and a real generate action
- **The seed created no accounting periods** — `prisma/seed.ts` builds the demo org by hand rather than through `bootstrapOrganization`, so it skipped them entirely and month-end close had nothing to operate on in dev or e2e

### 🧹 Removed (dead code)
- **28 unreferenced source files deleted (~2,600 lines)** — leftovers from the JS→TS migration and successive UI rewrites that still type-checked and still built, because an unimported file is perfectly valid TypeScript. The bulk is the pre-database client state layer: nine zustand stores (`useAPPaymentStore`, `useBankingStore`, `useCustomerStore`, `useGLStore`, `useIntegrationStore`, `useInventoryStore`, `usePaymentStore`, `useReturnStore`, `useVendorStore`), the `stores/index.ts` barrel, and `useInvoiceWorkbenchStore` + `data/invoiceWorkbenchData.ts` — all superseded by the API hooks. Plus nine superseded components (`DocumentTabBar`, `DocumentActionBar`, `Tabs`, `SplitButton`, `JournalDetailModal`, `InvoiceWorkbenchLayout`, `ResetPasswordModal`, `SettlementCard`, `ReportPrintTemplate` — the tab bars replaced by `TwoLevelTabBar`), two duplicate report views (`reports/APAging.tsx`, `reports/CashFlow.tsx`, both reimplemented inside `Reports.tsx`), and `utils/taxCalculations.ts`, `utils/validation.ts`, `hooks/useDocumentTabs.ts`, `views/ap/PullFromPoModal.tsx`, `pos/views/ExceptionsView.tsx`

### ✨ Added
- **Dead-module gate** (`src/__tests__/module-reachability.test.ts`) — walks the import graph from every real entry point (both Vite mains, the middleware, instrumentation, the seed, every App Router `route.ts`/`page.tsx`, every test) and fails when a source file is reachable from none of them. Runs inside `npm test`, no extra CI infra. Ratchets both ways like the tenant-isolation gate: a new unreferenced file fails, and a baselined file that becomes referenced again must leave the list. The baseline is empty — `.d.ts` files are filtered out as ambient, so every future entry is real debt
- **Company picker is now the first screen after sign-in** (Accurate-style database list) — previously it only appeared for accounts belonging to more than one company, so a single-company user was dropped straight into the workspace and never chose anything. The gate is now the tab's own company pin: a fresh sign-in always picks (single-company accounts see a one-row list), while reloads and in-app navigation go straight through. `shouldShowCompanyPicker` in `src/lib/companyPicker.ts` is the single definition, shared by `ProtectedRoute` and the picker
- **A company can be created from the picker** — the "New company" form bootstraps the standard template (Indonesian COA, main warehouse, default roles, open periods) and drops you straight into the new company. Creation previously lived only in Settings → Companies, which sits behind an active company

### 🚑 Fixed
- **A user with no company could not get anywhere** — `POST /auth/login` refused them outright ("No organization found for user"), and even past that, `POST /api/v1/organizations` sat behind the middleware's active-org gate, so the first company could never be created through the app. Login now issues an identity-only session (empty membership list, `needsOrgSelection: true`) for an ACTIVE account, and company creation is exempt from the org gate via `isOrgOptionalPath`. Tenant-scoped routes still fail closed on that session — `resolveActiveOrg` rejects an empty membership list, and the middleware strips any client-supplied `x-org-id`/`x-role-type` rather than passing them through
- **Company creation authority no longer depends on the tab's active company** — the route reads the caller's memberships from the database (ADMIN of any company, or no company yet, plus an ACTIVE account) instead of trusting the `x-role-type` header, which is absent for exactly the two callers who need this route: a first-time user, and an admin sitting on the picker. A role revoked since the token was issued now takes effect immediately
- **The company pin survived in memory when `sessionStorage` throws** (Safari private mode, blocked site data) — without it the widened picker gate would have bounced such a browser back to the picker after every selection, forever
- **The new-company form's labels were not associated with their inputs** — the shared `Input` only wires `htmlFor` when given an `id`
- **Two imports still addressed `.ts` files by a `.js` extension** (`src/main.tsx`, `lib/__tests__/auth.test.ts`) — a JS→TS migration leftover the bundler papered over
- **A stale `[Unreleased]` note credited Banking's tab bar to `DocumentTabBar`** — Banking is a workspace document module rendered through `TwoLevelTabBar`; the component it named no longer exists

### 🎨 Changed (UI consistency)
- **Banking rebuilt on the standard workbench anatomy** — full-width `PageHeader` (single Export CSV action), Transfer / Payment / Receive actions on the list pane, and an in-page dense detail view (Summary / Audit tabs) matching Payments/Invoices; account cards remain as account filters with a dashed "+ Add Account" ghost card; standalone filter card gains a date-range filter and the table a record count
- **Bank statement import & line matching moved to the Reconciliation page** — rendered with the shared `Table`; manual matching is now a `SearchableSelect` over unmatched transactions (same-amount suggestions first) instead of a free-text transaction-ID input

### 🚑 Fixed
- **Bank statement matching was silently broken** — UI compared statuses against `Matched`/`Unmatched` while the API returns enum `MATCHED`/`UNMATCHED`, so Match buttons and the unmatched banner never appeared; statuses now normalized in `useBanking`
- **Creating bank transactions failed validation** — the form sent lowercase `status`/`taxType` values rejected by the API's zod enums
- **Manual match called a nonexistent endpoint** — now uses the real `PUT /bank-statements/:lineId`; `GET /bank-statements` no longer requires `bankAccountId` and gains a `?statementId=` mode that returns a statement with its lines (the UI previously expected lines the API never returned)
- **Statement line dates shifted back a day** across timezones — full ISO timestamps now preserved
- **Banking RBAC** — viewing a transaction no longer requires create permission

---

## [1.1.0] — 2026-06-11

### 🚑 Fixed
- **Blank white page on boot** — `index.html` still pointed at `/src/main.jsx`, which was renamed to `main.tsx` during the TypeScript migration; the app rendered nothing
- **Dev tooling guarded against stale agent worktrees** — Vite watcher and Vitest now ignore `**/.claude/**`, `dist`, `.next`; the test suite previously ran 19 duplicate copies of itself (2,880 tests instead of 167) with 56 phantom failures
- **"Bayar di tempat" now maps to COD** for marketplace payment imports

### ✨ Added
- **TikTok Shop order import** — the marketplace import wizard (AR → Invoices → Import) now parses TikTok Shop "Semua pesanan" / OrderSKUList exports alongside Shopee reports: English headers aliased onto the shared parser, field-description row skipped, unit price derived from SKU subtotal ÷ quantity, DANA/OVO/GoPay mapped to E-Wallet; wizard copy follows the selected shop's platform. Validated against real Cultusia exports (5,390-row full export and weekly BALANCE file)
- **PPN tax split on credit/debit notes** — new `taxAmount` column on `CreditNote`/`DebitNote`; applying a note now reverses Output Tax (DR arTax) / Input Tax (CR apTax) instead of burying the tax in the return expense; note-level `taxAccountId` overrides the org default
- **Sales Orders: Export CSV** action (previously missing vs Invoices)

### 🎨 Changed (UI consistency)
- **Route-level code splitting** — all 66 views now lazy-load via `React.lazy`; first paint no longer pulls ~280 modules
- **One workbench anatomy** — Sales Orders, Invoices, Payments, Returns & Credits, and Customers all share the same `PageHeader` (title + subtitle + actions) above the shared `DocumentTabBar`; three hand-rolled tab-bar copies removed
- **Sales Order form rebuilt on the Invoice form's layout** — compact single-row header, Item Details / Logistics & Notes tabs, quick-search bar to add items, right-aligned totals card; data model and save logic unchanged
- **Recurring Billing** — Recurring Invoices and Subscriptions merged into one page with Invoice Templates / Subscriptions / Plans tabs; `/ar/subscriptions` redirects to `/ar/recurring?tab=subscriptions`; sidebar trimmed by one entry

---

## [1.0.0] — 2026-03-22

### 🎉 First Production-Ready Release — Phase 1.1 + 2.4 Complete

#### Audit Log
- **`logAudit()` wired into all 38 API route handlers** — every POST (CREATE), PUT (UPDATE), and DELETE operation across all modules now writes a fire-and-forget audit record to PostgreSQL
  - Modules covered: invoices, AR/AP payments, bills, purchase orders, customers, vendors, accounts, journal entries, items, stock adjustments, bank accounts, bank transactions, employees, customer categories, credit/debit notes, sales/purchase returns
- **`/api/v1/audit-logs` endpoint** — list audit events per org with filtering
- **`AuditLogPanel.jsx`** — reusable UI panel showing audit history for any entity
- **`useAuditLog.js`** — React Query hook for fetching audit events

#### RBAC Route Enforcement
- **`PermissionRoute` component** (`src/components/auth/PermissionRoute.jsx`) — wraps protected routes; redirects to `/403` if the current user lacks the required `moduleKey`/`action` permission
- **`Forbidden.jsx`** (`src/pages/Forbidden.jsx`) — polished 403 page with smart fallback navigation (tries the first permitted module before falling back to dashboard)
- **All module routes in `App.jsx` wrapped** with `PermissionRoute` — direct URL navigation to restricted pages now redirects to `/403` instead of rendering the page

#### Data Migration Tool
- **`DataMigrationPanel.jsx`** in Settings — one-click migration of existing localStorage Zustand data to PostgreSQL
  - Migrates: customers, vendors, inventory items (with field mapping/normalization per entity)
  - Per-store progress indicators, error reporting, and idempotent (safe to re-run)

#### Per-Action UI Enforcement
- **`useModulePermissions(moduleKey)` hook** (`src/hooks/useModulePermissions.js`) — returns `{ canView, canCreate, canEdit, canDelete }` derived from the authenticated user's role permissions
- **All 20+ list and form pages wired** — Create / Edit / Delete buttons are disabled (with `opacity-60 cursor-not-allowed`) when the user lacks the required permission; no silent failures
  - Covered: Invoices, Sales Orders, Customers, Customer Categories, AR Payments, Credit Notes, Sales Returns, Bills, Purchase Orders, AP Payments, Debit Notes, Purchase Returns, Vendors, Chart of Accounts, Journal Entries, Banking, Items, Inventory Adjustments, Employees

#### Document-Level Permissions (Invoice Ownership)
- **`InvoiceAccessScope` enum** added to Prisma schema (`ALL` | `OWN`) — roles can be restricted to seeing only their own invoices
- **`invoiceAccessScope` field** on the `Role` model — Admins always get `ALL`; custom roles default to `ALL` but can be set to `OWN`
- **`createdById` field** on `SalesInvoice` — tracks which user created each invoice for ownership filtering
- **`lib/document-access.ts`** — `getInvoiceAccessContext()` server utility that resolves the user's scope from the DB; `AccessError` class for 403 responses
- **`useAuthStore`** updated — `hasPermission(moduleKey, action)` method; `invoiceAccessScope` and `permissions[]` populated from API `/auth/me` response; `hasModulePermission` standalone utility exported

#### Seed Data
- **Cashier role** added to `prisma/seed.ts` — `roleType: CUSTOM`, `invoiceAccessScope: OWN`, permissions: Dashboard (view), AR Invoices (view/create/edit), Customers (view), AR Payments (view/create); working hours Mon–Sat 08:00–18:00

#### Loading Skeletons
- **`LoadingSkeleton.jsx`** — `SkeletonBlock` and `TableSkeleton` components for consistent loading states
- Applied to Banking and Chart of Accounts pages

### 🔄 Changed
- ROADMAP.md updated: all v1.0 items marked complete; version bumped to v1.0.0

---

## [Unreleased] — Roadmap

Features planned for upcoming releases.

### 🔴 Critical (All Businesses)
- **Inventory Valuation** — FIFO / Weighted Average costing, COGS auto-calculation
- **Bank Statement Import** — CSV/OFX import + auto-matching + reconciliation
- ~~**Backend routes for remaining sub-modules**~~ ✅ Done in v0.9.0
- **Vendor Categories** — group vendors by type (like Customer Categories)

### 🟡 Beauty Clinic
- Service packages — bundle multiple treatments at one price
- Practitioner / therapist tracking on invoices
- Recurring billing for treatment plans
- Duration and room fields on service-type inventory items

### 🟡 E-Commerce
- Marketplace fee auto-posting per platform (Shopee, Tokopedia, TikTok, Lazada)
- Shipping cost field per order/invoice
- Multi-warehouse inventory (stock split by location)
- COGS costing method — FIFO or Weighted Average
- Sales channel dimension in reports
- Bulk invoice import from CSV / marketplace export

### 🟡 Offline Store (Beauty & Pharmacy)
- Batch number & expiry date tracking on inventory items
- Expiry date alerts and low-stock notifications
- BPOM / product registration number field on items
- Multi-price tier — wholesale vs. retail selling price
- Supplier price list / purchase price history
- Stock opname / physical count module

---

## [0.9.0] — 2026-03-22

### ✨ Added — Frontend → Backend Connection (All Modules Wired)
- **All 6 core modules now read/write via React Query hooks** — Banking, GL, AR, AP, Inventory, HR fully wired to PostgreSQL backend
- Hook files: `useBanking.js`, `useGL.js`, `useAR.js`, `useAP.js`, `useInventory.js`, `useHR.js` (all in `src/hooks/`)
- **13 list pages** read from API via `useQuery`; **10 form pages** write via `useMutation`
- Field normalization in hooks: uppercase API enums ↔ title-case UI values; Prisma Decimal coerced to Number; API-generated IDs used as display IDs
- **Sub-module API routes + hooks** — Credit Notes, Debit Notes, Sales Returns, Purchase Returns, Customer Categories, Warehouses
  - 12 new route files in `src/app/api/v1/` (credit-notes, debit-notes, sales-returns, purchase-returns, customer-categories, warehouses)
  - `useReturns.js` hook with full CRUD for all sub-modules + warehouses + customer categories
  - All 11 pages previously importing from `mockData` now use React Query hooks — **zero mockData imports remain in pages/**
- **Error boundaries** — `ErrorBoundary` component with `PageErrorFallback` and `WidgetErrorFallback` variants
  - Wraps entire App router, Dashboard page, and each dashboard widget independently
- **Unit tests** — Vitest installed; 26 tests passing for `formatters.js` and `shopeeImport.js`

### 🐛 Fixed
- **`formatIDR('not-a-number')` returned `'RpNaN'`** — now safely coerces to `Rp0,00` (caught by new test suite)

### 🗑️ Removed — Dead Code Cleanup
- Deleted `src_vanilla/` — legacy vanilla JS codebase (unused since Tailwind migration)
- Deleted empty `src/components/Customers/` directory
- Deleted `PLAN-roadmap-sync-landing-pages.md` — stale execution plan

### 🔄 Changed
- **Manufacturing/BOM moved to separate project** — will be developed as MSM Manufacturing, a standalone premium add-on integrating via API
- Updated ROADMAP.md to reflect v0.9.0 status and manufacturing separation

---

## [0.8.1] — 2026-03-06

### ✨ Added
- **Google OAuth sign-in (credential flow)** integrated end-to-end:
  - Frontend Google provider + sign-in button wiring on Login page (`@react-oauth/google`)
  - Backend endpoint `POST /api/v1/auth/google` verifies Google ID token via `google-auth-library`
  - Successful Google sign-in now issues the same JWT httpOnly cookie session (`msm_token`) as email/password login
  - Access is restricted to already-provisioned users in the database (no implicit auto-registration)

### 🔄 Changed
- **Login page UI refresh** with a cleaner modern/minimalist layout:
  - New responsive split layout (brand/content panel + focused auth card)
  - Updated spacing, hierarchy, and copy for faster scan/readability
  - Kept current theme token system and existing auth form components for consistency

### 🐛 Fixed
- **Google login visibility/config confusion**:
  - Clarified and wired required env vars for both apps (`GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`)
  - Google sign-in section now appears correctly when frontend env is configured

## [0.5.1] — 2026-02-25

### 🐛 Fixed — Remaining Tier 1 Form Save Gaps

#### BankingActionForm.jsx
- `handleSave()` now persists data to `useBankingStore` before navigating
  - **Transfer / Expense / Income** actions → calls `addTransaction()` with a properly structured transaction record (signed amount, type, accountId, taxType, costCenter, reference, etc.)
  - **Add Account** action → calls `addBankAccount()` with the new account object

#### SalesReturnForm.jsx
- On "Save & Create Credit Note", now calls `useReturnStore.addSalesReturn()` (or `updateSalesReturn()` in edit mode) to persist the return record with status `'Pending Credit Note'` before navigating to the credit note form

#### PurchaseReturnForm.jsx
- On "Save & Create Debit Note", now calls `useReturnStore.addPurchaseReturn()` (or `updatePurchaseReturn()` in edit mode) to persist the return record with status `'Pending Debit Note'` before navigating to the debit note form

#### Dashboard.jsx
- Replaced all hardcoded mockData stats and recent invoices with live data from Zustand stores:
  - **Cash on Hand** → `useBankingStore.bankAccounts` balance sum
  - **Overdue Invoices** → `useInvoiceStore.invoices` filtered by `status === 'Overdue'`
  - **Net Cash Flow (YTD)** → `useBankingStore.transactions` summed for current year
  - **Recent Invoices table** → last 5 invoices from `useInvoiceStore`, sorted by date descending
  - Added "View All" button on Recent Invoices card → navigates to `/ar/invoices`

---

## [0.5.0] — 2026-02-25

### ✨ Added — Tier 1: Complete Edit Routes & Store Connections

#### Edit Routes
- **`/ar/payments/edit`** — AR Payments now has a dedicated edit route (previously incorrectly reused `/new`)
- **`/ar/credits/edit`** — AR Credit Notes edit route added
- **`/ap/payments/edit`** — AP Payments edit route added
- **`/ap/debits/edit`** — AP Debit Notes edit route added
- **`/gl/journals/edit`** — GL Journal Entries edit route added; list view's View/Edit button navigates to edit form populated with the selected entry

#### Store Connections (Data Persistence)
- **`usePaymentStore` seeded** — was previously initialized as `payments: []` (empty); now seeded with `arPayments` from mockData so AR Payments list shows data on first load
- **`useBankingStore` — transactions added** — store now holds a `transactions` array with seed data + full CRUD (`addTransaction`, `updateTransaction`, `deleteTransaction`, `getTransactionById`); store version bumped to `2`
- **`Banking.jsx`** — accounts now read from `useBankingStore` (was `initialAccounts` from mockData); transactions read from `useBankingStore.transactions` (was hardcoded `MOCK_TRANSACTIONS` constant)
- **`AR Payments.jsx`** — payments list now reads from `usePaymentStore` (was `arPayments` from mockData)
- **`AR PaymentForm.jsx`** — on save, calls `addPayment` (create) or `updatePayment` (edit) on `usePaymentStore`; loads existing payment from store in edit mode
- **`AR CreditNotes.jsx`** — `creditNotes` and `salesReturns` now read from `useReturnStore` (was mockData)
- **`AR CreditNoteForm.jsx`** — on save, calls `addCreditNote` or `updateCreditNote` on `useReturnStore`
- **`AP Payments.jsx`** — payments list now reads from `useAPPaymentStore` (was `apPayments` from mockData)
- **`AP PaymentForm.jsx`** — on save, calls `addPayment` or `updatePayment` on `useAPPaymentStore`; loads existing payment from store in edit mode
- **`AP DebitNotes.jsx`** — `debitNotes` and `purchaseReturns` now read from `useReturnStore` (was mockData)
- **`AP DebitNoteForm.jsx`** — on save, calls `addDebitNote` or `updateDebitNote` on `useReturnStore`
- **`JournalEntries.jsx`** — entries now read from `useGLStore.journalEntries` (was hardcoded `INITIAL_ENTRIES` array); `totalDebit`/`totalCredit` computed live from entry lines
- **`JournalEntryForm.jsx`** — on Save Draft, calls `addJournalEntry`/`updateJournalEntry` with `status: 'Draft'`; on Post Entry, same with `status: 'Posted'`; in edit mode, loads existing entry lines and header from `useGLStore`

### 🐛 Fixed
- **AR Payments Edit button navigated to `/ar/payments/new`** instead of a proper edit route — now uses `/ar/payments/edit`
- **AP Payments Edit button navigated to `/ap/payments/new`** — now uses `/ap/payments/edit`
- **AP Debit Notes Edit button navigated to `/ap/debits/new`** — now uses `/ap/debits/edit`
- **AR Credit Notes Edit button navigated to `/ar/credits/new`** — now uses `/ar/credits/edit`
- **Journal Entries had no edit navigation at all** — View/Edit button in list now navigates to `/gl/journals/edit` with entry data
- **Banking.jsx had no persistence** — bank accounts and transactions were reset on every page refresh; now persisted via Zustand `msm-banking` store (version 2)

---

## [0.4.0] — 2026-02-25

### ✨ Added — Reports: Period Selection & Comparison
- **Balance Sheet & P&L period selector** — both reports now have a date range control (This Month / Quarter / Year / Custom etc.). Previously they showed only the static opening-balance snapshot regardless of period
- **Compare Period toggle** on Balance Sheet & P&L — click "⇄ Compare Period" to enable side-by-side comparison mode:
  - **Period A** selector (left) — primary period
  - **Period B** selector (right) — comparison period, defaults to the previous equivalent (e.g. Last Year when A = This Year)
  - Side-by-side columns: Period A amount | Period B amount | Variance (±) | % Change
  - Variance colored green (positive) / red (negative)
- Supports all comparison types out of the box: **Quarter vs Quarter**, **Year-over-Year**, **Month vs Month**, or any two custom date ranges
- **Period-aware balance computation** (`computePeriodBalances`) — derives account balances for any date range by applying journal entry debit/credit movements on top of the opening balance snapshot; Balance Sheet and P&L now correctly reflect the selected period instead of always showing all-time balances
- All journal entries now read from **`useGLStore`** (persisted) instead of `mockData` seed — new entries posted via Journal Entries form will appear immediately in all reports
- **`isInRange` memoized with `useCallback`** — fixes stale-closure bug where GL Detail, Sales, and Aging reports didn't properly re-filter when date range changed

### 🐛 Fixed
- **Balance Sheet & P&L ignored period filter** — `showDateFilter` excluded them so the date selector never appeared and `buildGroupedRows` always used static `accountBalancesById`
- **`glDetail` useMemo had wrong dependency** — `isInRange` was a plain function defined inside render, not listed as a dependency, so GL Detail never updated when period changed
- **`filteredSalesLines` missing `salesLines` in deps array** — caused stale data when store updated

---

## [0.3.0] — 2026-02-25

### ✨ Added
- **Purchase Order (PO) module** — full CRUD: PO list, POForm (create/view/edit), Zustand store with persist (`msm-po-storage`)
- **Inventory Adjustments** — full CRUD: Adjustments list, AdjustmentForm (create/view/edit), connected to `useInventoryStore`
- **AP Aging Report** — overdue payables breakdown by bucket (Current / 1–30 / 31–60 / 61–90 / 90+), tab added to Reports page
- **Cash Flow Statement** — direct method, segregates operating inflows vs outflows, tab added to Reports page
- **Tax Configuration (PPN 11%)** — `useSettingsStore` with `taxSettings` (rate, enabled, inclusiveByDefault); Settings page has tax UI; InvoiceForm and POForm read global tax rate
- `useSettingsStore` and `usePurchaseOrderStore` added to `src/stores/index.js` central export
- Purchase Orders nav item added to Accounts Payable sidebar section
- Inventory Adjustments nav item added to Inventory sidebar section
- `/ap/pos`, `/ap/pos/new`, `/ap/pos/edit` routes registered in App.jsx
- `/inventory/adjustments`, `/inventory/adjustments/new`, `/inventory/adjustments/edit` routes registered in App.jsx

### 🐛 Fixed
- **`agingInvoices` not imported in `Reports.jsx`** — AR Aging tab crashed at runtime with `ReferenceError: agingInvoices is not defined`; now read from `useReportStore`
- **`salesLines` pulled from `mockData` in `Reports.jsx`** — Sales by Item / Sales by Customer tabs used stale hardcoded data; now read from `useReportStore` (persisted)
- **`Inventory.jsx` used hardcoded `MOCK_ITEMS`** — list page ignored the Zustand store entirely; now reads from `useInventoryStore`; stock status computed from `openingStock` qty
- **`InventoryForm.jsx` never saved to store** — `handleSave` only navigated away without persisting; now calls `addProduct` (create) or `updateProduct` (edit) on `useInventoryStore`
- **`InventoryForm.jsx` item lookup used `INVENTORY_ITEM_SEED`** — edit mode couldn't find items added via the form; now looks up from store first, seed as fallback

---

## [0.2.0] — 2026-02-25

### ✨ Added
- **Tailwind CSS v4** fully integrated with `@tailwindcss/vite` plugin
- Custom design token system via `@theme` block in `index.css` — colors, font sizes, radii, shadows all tokenized
- `tailwind-modules.css` — component-layer CSS using `@layer components` + `@apply` for shared patterns (`form-label`, `grid-12`, `invoice-panel`, `dense-*`, `filter-bar`, `workbench-doc-tab`, `banking-*`, etc.)
- `fcBase` and `fcSmInline` reusable Tailwind class strings for form controls across all form pages

### 🔄 Changed
- **All pages and components migrated from vanilla CSS to Tailwind** — Layout, Sidebar, Dashboard, GL, AR, AP, Inventory, Banking, Reports, Settings, CompanySetup, Integrations
- `grid-12` moved from `layout.css` into `tailwind-modules.css` as a proper `@layer components` block
- `col-span-*` now uses Tailwind v4 built-ins (no longer custom-defined)
- `ar-module`, `ap-module`, `settings-module`, `container-full-width` consolidated into `tailwind-modules.css`

### 🗑️ Removed
- `src/styles/layout.css` — deleted; all active classes migrated or superseded by Tailwind
- Dead CSS from `tailwind-modules.css`: `form-control`, `form-control-sm`, `form-group`, `form-feedback`, `invalid-feedback`, `btn`, `btn-primary`, `btn-secondary`, `btn-tertiary`, `btn-danger`, `btn-medium`, `btn-small`, `btn-large`, `btn-icon`
- `@import './styles/layout.css'` removed from `index.css`
- Previously removed in earlier cleanup: `variables.css`, `reset.css`, `typography.css`, `main.css`

### 🐛 Fixed
- Missing named imports in `Customers.jsx`, `Bills.jsx`, `Vendors.jsx` causing runtime errors on load

---

## [0.1.0] — Initial Build

### ✨ Added
- **General Ledger** — Chart of Accounts with account hierarchy, Journal Entries with balanced debit/credit validation
- **Accounts Receivable**
  - Invoices list + Invoice workbench (multi-tab: Items, Logistics, Attachments, Audit/Journal)
  - Invoice form with line items, discount, tax, numbering modes
  - AR Payments — apply to invoices, discount/penalty adjustment
  - Credit Notes — issue credits against customers
  - Sales Returns — process returned goods
  - Customers list + Customer form (contact, credit limit, payment terms)
  - Customer Categories
- **Accounts Payable**
  - Bills list + Bill form
  - AP Payments — apply to bills, discount/penalty adjustment
  - Debit Notes — issue debits against vendors
  - Purchase Returns — process returned purchases
  - Vendors list + Vendor form
- **Inventory** — item list with stock status, item form (SKU, category, type, unit, cost/price, margin preview, GL account mapping)
- **Banking** — bank account overview, transaction list, transfer/expense/income/account forms
- **Reports** — Balance Sheet, Profit & Loss, Trial Balance, GL Detail, Sales by Item, Sales by Customer, AR Aging (with period presets and custom date range)
- **Company Setup** — company info, NPWP, PKP status, fiscal year, accounting periods
- **Settings** — company info, credit limit config, security roles, notification preferences
- **Integrations** — e-commerce shop connections (Shopee, TikTok, Tokopedia, Lazada) with customer and settlement account mapping
- **Dashboard** — KPI cards (Cash on Hand, Overdue Invoices, Net Profit YTD), recent invoices table
- Indonesian Rupiah (IDR) formatting throughout — `formatIDR` and `formatDateID` utilities
- Zustand stores for AR, AP, GL, Inventory, Banking state management
