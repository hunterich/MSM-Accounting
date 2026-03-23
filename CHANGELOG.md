# Changelog — MSM Accounting Software

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
