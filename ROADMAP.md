# MSM Accounting Software — Improvement Roadmap

> Benchmarked against ERPNext (open-source ERP).
> Created 2026-02-27 | Current version: v1.0.0

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[~]` | Partially done / exists but incomplete |
| `[x]` | Already implemented |

---

## Phase 1 — Core Gaps (Foundation)

> Goal: Fix fundamental limitations that block everything else.

### 1.1 Database Backend
- [x] Migrate from localStorage to a real database (SQLite / PostgreSQL / Supabase)
  - PostgreSQL running; 43 tables applied via `prisma db push`; API route handlers live across modules; JWT auth + middleware enabled
  - All list pages read from API via React Query hooks; all form pages write via React Query mutations
  - Remaining on Zustand: batch import (Shopee ImportInvoicesModal); print item templates
- [x] Proper CRUD with server-side validation
  - Zod validation in existing routes; all new routes have try/catch + `withCors` error responses; ~60 route handlers total
  - 10 form pages wired: CustomerForm, InvoiceForm, AR PaymentForm, VendorForm, BillForm, POForm, AP PaymentForm, InventoryForm, AdjustmentForm, EmployeeForm
- [x] User authentication (email/password login + JWT sessions + Next.js middleware protecting `/api/v1/*`; httpOnly cookie `msm_token`; seed script creates org + admin user)
- [x] Google OAuth sign-in (Google Identity credential flow on frontend + backend ID token verification via `google-auth-library`; access restricted to provisioned users in DB)
- [x] Complete API routes — all CRUD handlers for invoices, customers, AR payments, bills, vendors, purchase orders, AP payments, accounts/COA, journal entries, items, stock adjustments, bank accounts, bank transactions, employees; `lib/api-utils.ts` with `ok/err/listResponse/nextNumber` helpers; React Query v5 installed + `QueryClientProvider` wrapping app; seed expanded with 15 COA accounts, 5 customers, 4 vendors, 3 employees, 5 items, 4 invoices, 3 bills, 2 POs, 2 AR payments, 3 journal entries, 5 bank transactions, 1 stock adjustment
- [x] Connect frontend stores to backend API (React Query; replace 18 Zustand mock stores)
  - All 6 modules wired: Banking ✓ GL ✓ AR ✓ AP ✓ Inventory ✓ HR ✓
  - Hook files: `useBanking.js`, `useGL.js`, `useAR.js`, `useAP.js`, `useInventory.js`, `useHR.js`
  - All 13 list pages read from API; all 10 form pages with API routes write via mutations
  - Field normalization: uppercase API enums ↔ title-case UI values; Prisma Decimal coerced to Number; API-generated numbers (BILL-xxxxx, EMP-xxxxx, etc.) used as display IDs
  - All sub-modules now wired: CreditNote, DebitNote, SalesReturn, PurchaseReturn, CustomerCategories, Warehouses — API routes + React Query hooks
  - `useReturns.js` hook file: credit notes, debit notes, sales returns, purchase returns, warehouses, customer categories
  - Batch import operations (Shopee ImportInvoicesModal) and print item templates still use local Zustand stores as intermediary
- [x] Data migration tool (localStorage → DB for existing users) — `DataMigrationPanel.jsx` in Settings; migrates customers, vendors, items from localStorage Zustand stores to PostgreSQL via API batch POST

### 1.2 Print / PDF Export
- [x] Printable invoice layout (A4) — `src/components/print/InvoicePrintTemplate.jsx`
- [x] Printable bill layout (A4) — `src/components/print/BillPrintTemplate.jsx`
- [x] Printable PO layout (A4) — `src/components/print/PurchaseOrderPrintTemplate.jsx`
- [x] Export to CSV — invoices list + bills list (`src/utils/exportCsv.js`)
- [x] Company letterhead on printed documents (name, address, NPWP, phone, email, logo)
- [x] Report export to PDF
- [x] Report export to Excel / XLSX
- [x] Print preview before printing (currently uses browser native print dialog)

### 1.3 Sales Order Module
- [x] Sales Order CRUD (list, create, edit, view) — `SalesOrderWorkbench`, `SOForm`, tabbed detail panel
- [x] Sales Order → Invoice conversion (one-click) — `convertToInvoice()` in store; button on Confirmed/Delivered SOs
- [x] Sales Order status workflow (Draft → Confirmed → Delivered → Invoiced → Closed) — status badges + transitions
- [x] Printable Sales Order layout (A4) — `SalesOrderPrintTemplate.jsx`
- [ ] Delivery Note generation from Sales Order
- [ ] Partial fulfillment tracking (qty delivered vs ordered)

### 1.4 Inventory Valuation
- [ ] FIFO costing method
- [ ] Weighted Average costing method
- [ ] Perpetual inventory (auto GL posting on stock movements)
- [ ] COGS auto-calculation on invoice line items
- [ ] Stock valuation report

### 1.5 Bank Statement Import & Reconciliation
- [ ] CSV / OFX bank statement import
- [ ] Auto-matching rules (by amount, reference, date)
- [ ] Manual match/unmatch interface
- [ ] Reconciliation summary report
- [~] Basic transaction matching exists but no import

### 1.6 Data Import / Export
- [ ] CSV import for customers, vendors, items, COA, opening balances
- [ ] CSV export for all list views
- [~] Bulk invoice import from marketplace exports — Shopee 6-step wizard complete (`ImportInvoicesModal.jsx` + `shopeeImport.js` + `useIntegrationStore.js`); Tokopedia / TikTok Shop / Lazada not started

---

## Phase 2 — Business Critical (Revenue Impact)

> Goal: Features required by target market (beauty clinics, pharmacies, e-commerce sellers).

### 2.1 POS (Point of Sale)
- [ ] Browser-based POS interface
- [ ] Product search + barcode scanning
- [ ] Cart with qty adjustment, discount per line
- [ ] Multiple payment methods (cash, card, QRIS, split payment)
- [ ] Cash change calculation
- [ ] Receipt printing (thermal printer support)
- [ ] POS closing / end-of-day summary
- [ ] Offline mode with sync (localStorage fallback)
- [ ] POS Profile per user / warehouse

### 2.2 Batch & Expiry Tracking
- [ ] Batch number field on inventory items
- [ ] Expiry date per batch
- [ ] Expiry alerts (30 / 60 / 90 day warnings)
- [ ] FEFO picking (First Expiry, First Out)
- [ ] Batch selection on invoice / PO / stock movements
- [ ] BPOM / product registration number field
- [ ] Batch-level stock report

### 2.3 Recurring Invoices / Subscriptions
- [ ] Recurring invoice templates (monthly, quarterly, annual)
- [ ] Auto-generation schedule
- [ ] Subscription plans with trial period
- [ ] Subscription status lifecycle (Active, Past Due, Cancelled)
- [ ] Pro-rata billing on cancellation

### 2.4 Multi-User & Role-Based Permissions
- [x] Security & Roles settings UI (Akses Grup) — Accurate-style module group sidebar + permission matrix
- [x] Role definitions persisted in Zustand store (Administrator, Accounting Staff, View Only)
- [x] Per-module CRUD permission matrix: Aktif / Buat / Ubah / Hapus / Lihat
- [x] Sidebar RBAC filtering — nav items hidden based on user role permissions
- [x] User ↔ Role assignment (Daftar Pengguna)
- [x] User switcher in header replaced with real auth — JWT login, real username/org displayed, Logout button
- [x] Access time & day restrictions per role (Pembatasan Akses)
- [x] User authentication — Login page, JWT httpOnly cookie (`msm_token`), `ProtectedRoute` wrapper, session persistence on refresh
- [x] Login UX refresh — modern/minimalist responsive sign-in layout aligned with current product theme tokens
- [x] Document-level permissions (invoice ownership + per-role "all" vs "own" visibility)
- [x] Audit log (who changed what, when) — `logAudit()` wired into all 38 API route handlers (POST/PUT/DELETE); `AuditLog` Prisma model; `/api/v1/audit-logs` endpoint; `AuditLogPanel.jsx` UI; `useAuditLog.js` React Query hook
- [x] Enforce RBAC on routes (redirect to /403 if user navigates directly to restricted URL) — `PermissionRoute` wrapper component; `Forbidden.jsx` page with smart fallback navigation; wired into App.jsx for all module routes

### 2.5 Email Integration
- [ ] Send invoice PDF to customer via email
- [ ] Automated payment reminders (overdue invoices)
- [~] Notification toggle exists in settings but not wired
- [ ] Send PO to vendor via email
- [ ] Email templates (customizable)

### 2.6 Vendor Categories
- [ ] Vendor category CRUD (like Customer Categories)
- [ ] Category-specific defaults (payment terms, GL account)
- [ ] Filter vendors by category

---

## Phase 3 — Growth Features

> Goal: Compete with mid-tier ERP systems. Unlock larger clients.

### 3.1 CRM Module
- [ ] Lead capture (manual + web form)
- [ ] Lead status pipeline (New -> Contacted -> Qualified -> Won/Lost)
- [ ] Opportunity tracking with expected value
- [ ] Kanban board view for pipeline
- [ ] Quotation / Proforma Invoice generation
- [ ] Quotation -> Sales Order conversion
- [ ] Activity log per lead (calls, emails, notes)
- [ ] Sales person assignment & commission tracking

### 3.2 HR & Payroll (Employee Master Data & Payroll Run)
- [~] **Employee Master Data:**
  - [x] Personal info (Name, KTP, DOB, Contact, Address)
  - [x] Employment details (Join Date, Department, Job Title, Employment Status)
  - [x] Bank details (Bank Name, Account Number, Account Holder)
  - [x] Government IDs (NPWP, BPJS Kesehatan, BPJS Ketenagakerjaan)
  - [x] Salary Structure (Basic Salary, Default Allowances, Default Deductions)
- [ ] **Attendance & Leave Management:** (placeholder page at /hr/attendance)
  - [ ] Time tracking / Daily attendance (manual entry or import)
  - [ ] Leave types (Annual, Sick, Unpaid)
  - [ ] Leave balance management
- [ ] **Payroll Processing & Generation:** (placeholder page at /hr/payroll-run)
  - [ ] Monthly batch run (generate payslips for all active employees)
  - [ ] Variable component entry (Overtime, Bonuses, Penalties per run)
  - [ ] PPh 21 Tax calculation (TER integration)
  - [ ] BPJS calculations (Employer vs Employee portions)
  - [ ] Salary slip PDF generation
- [ ] **Accounting Integration:**
  - [ ] Auto-post Payroll Summary Journal Entry upon approval (Debit Salary Expense, Credit Bank/Taxes Payable)

### 3.3 Asset Management
- [ ] Fixed asset register
- [ ] Asset categories (Furniture, Equipment, Vehicle, etc.)
- [ ] Depreciation methods (Straight Line, Declining Balance)
- [ ] Automated monthly depreciation journal entries
- [ ] Asset disposal / write-off
- [ ] Asset movement tracking (location, custodian)
- [ ] Asset maintenance schedule

### 3.4 Budget Controls
- [ ] Budget definition per GL account / cost center / department
- [ ] Budget periods (monthly, quarterly, annual)
- [ ] Budget vs Actual report
- [ ] Budget enforcement modes: Warn, Block, or Silent
- [ ] Budget variance alerts

### 3.5 E-Commerce Auto-Posting
- [~] Shop connections + per-shop settings in `useIntegrationStore.js`; Integrations.jsx manages shop list
- [~] Auto-import orders: Shopee done (6-step import wizard, Excel parse, item mapping, upsert); Tokopedia / TikTok / Lazada not started
- [ ] Auto-create invoices from marketplace orders
- [ ] Marketplace fee auto-posting (commission, shipping subsidy, voucher)
- [ ] Platform wallet balance tracking
- [ ] Settlement reconciliation (platform payout vs bank deposit)
- [ ] Sales channel dimension in reports

### 3.6 Procurement Improvements
- [ ] Request for Quotation (RFQ) to multiple suppliers
- [ ] Supplier quotation comparison (side-by-side)
- [ ] Material Request (auto from low stock)
- [ ] Landed cost allocation (freight, duty, customs)
- [ ] Supplier scorecard / performance tracking
- [ ] Purchase price history per item per vendor

### 3.7 Advanced Inventory
- [ ] Serial number tracking (per-unit)
- [ ] Item variants (size, color, weight)
- [ ] Product bundles / kits
- [ ] Multiple UOM (purchase UOM vs stock UOM vs sales UOM)
- [ ] Auto-reorder alerts with configurable min/max levels
- [ ] Stock opname / physical count module with variance report
- [ ] Multi-price tiers (wholesale, retail, VIP)
- [ ] Quality inspection on receipt

---

## Phase 4 — Advanced / Enterprise

> Goal: Full ERP capability. Multi-company, manufacturing, project management.

### ~~4.1 Manufacturing / BOM~~ — Moved to separate project (MSM Manufacturing)

> Manufacturing (BOM, work orders, production planning, MRP) will be developed as a
> standalone premium add-on that integrates with MSM Accounting via API.
> See: MSM Manufacturing (separate repo).

### 4.2 Project Management
- [ ] Project CRUD with tasks and milestones
- [ ] Task dependencies and Gantt chart view
- [ ] Timesheet tracking linked to projects
- [ ] Project-based billing
- [ ] Project cost & margin tracking
- [ ] Project templates for repeatable work

### 4.3 Multi-Company Support
- [ ] Separate Chart of Accounts per company
- [ ] Company selector in UI
- [ ] Inter-company transactions
- [ ] Consolidated financial statements (Balance Sheet, P&L)
- [ ] Company-specific user permissions

### 4.4 Workflow / Approval Engine
- [ ] Configurable approval chains per document type
- [ ] Multi-level approval (Manager -> Director -> Finance)
- [ ] Status transitions (Draft -> Pending Approval -> Approved -> Posted)
- [ ] Email notifications on pending approvals
- [ ] Approval delegation

### 4.5 REST API
- [ ] Full REST API for all entities (customers, invoices, items, etc.)
- [ ] API key authentication
- [ ] Webhook support (on invoice created, payment received, etc.)
- [ ] API documentation (Swagger / OpenAPI)
- [ ] Third-party integration framework

### 4.6 Advanced Reporting
- [ ] Custom report builder (drag-and-drop fields)
- [ ] Scheduled report email delivery
- [ ] Dashboard with interactive charts (bar, line, pie, donut)
- [ ] Drill-down from summary to transaction level
- [ ] Multi-currency report conversion
- [ ] Comparative reporting across companies

---

## Phase 5 — Domain-Specific Features

> Goal: Specialized features for MSM's target verticals.

### 5.1 Beauty Clinic
- [ ] Service package bundling (multiple treatments at one price)
- [ ] Practitioner / therapist assignment on invoices
- [ ] Treatment room scheduling
- [ ] Duration tracking per service
- [ ] Client treatment history
- [ ] Appointment booking system
- [ ] Membership / loyalty points

### 5.2 Pharmacy
- [~] Batch & expiry partially covered in Phase 2.2
- [ ] Drug interaction warnings
- [ ] Prescription tracking
- [ ] Controlled substance log
- [ ] BPOM compliance fields
- [ ] Supplier return for expired stock

### 5.3 E-Commerce Seller
- [~] Marketplace integration partially covered in Phase 3.5
- [ ] Multi-channel inventory sync (stock across all platforms)
- [ ] Shipping label generation
- [ ] Return/refund automation per platform
- [ ] Marketplace performance dashboard
- [ ] Profit per SKU per channel report

---

## Technical Debt & Infrastructure

> Ongoing improvements that support all phases.

| Item | Status | Priority |
|------|--------|----------|
| Migrate to real database (Phase 1.1) | Done — PostgreSQL + Prisma (43 tables); auth + API routes; all 6 modules wired (reads + writes); 4 sub-modules pending backend routes (credit/debit notes, sales/purchase returns) | Critical |
| Add TypeScript | Not started | Medium |
| Unit tests for stores & utils | [~] Vitest installed; formatters + shopeeImport tests passing (26 tests) | High |
| E2E tests (Playwright/Cypress) | Not started | Medium |
| Error boundaries & error handling | [x] ErrorBoundary component with page/widget variants; wraps App, Dashboard, and each widget | High |
| Loading states & skeleton screens | [~] `LoadingSkeleton.jsx` (`SkeletonBlock`, `TableSkeleton`) added; not yet applied to all pages | Medium |
| Mobile responsive layout | Not started | Medium |
| Accessibility (a11y) audit | Not started | Low |
| Virtual scrolling / lazy-load for large lists (Accurate pattern) | [~] Table.jsx supports @tanstack/react-virtual (auto >50 rows), record count footer on all list pages | **Critical** |
| Performance optimization (large datasets) | Not started | Medium |
| i18n framework (proper ID/EN switching) | Not started | Low |
| CI/CD pipeline | Not started | Medium |
| Backup & restore functionality | Not started | High |

---

## UX Patterns — Inspired by Accurate Online

> Key design patterns observed from iris.accurate.id to adopt in MSM.

### Sidebar Navigation (Implemented v0.5.1)
- [x] 55px icon-only rail with dark navy gradient
- [x] Red hover/active indicator (#e01e2c)
- [x] Flyout sub-menu on hover for ALL sidebar items (consistent behavior)
- [x] Tooltip for label on hover
- [x] Flyout closes on sub-item click
- [x] **RBAC-based visibility** — sidebar items & sub-items filtered by user role (Accurate Akses Grup pattern)

### Access Control (Akses Grup) — Implemented v0.5.1
- [x] **Accurate-style Hak Akses UI** — split panel with module group sidebar + permission checkbox table
- [x] Module groups: Dashboard, General Ledger, AR, AP, Inventory, Banking, HR & Payroll, Integrations, Reports, Company, Settings
- [x] Permission columns: Aktif (Active/View), Buat (Create), Ubah (Edit), Hapus (Delete), Lihat (View)
- [x] Select All toggle per group
- [x] Pembatasan Akses (time & day restrictions) per role
- [x] Persisted via Zustand + localStorage (`msm-access` key)
- [x] Sidebar dynamically filters based on current user's role permissions
- [x] Route-level enforcement — auth guard (`ProtectedRoute` + API middleware) + RBAC blocking via `PermissionRoute` → `/403` redirect
- [x] Per-action enforcement in UI — `useModulePermissions(moduleKey)` hook returns `{ canCreate, canEdit, canDelete }`; all 20+ list/form pages disable Create/Edit/Delete buttons when user lacks permission

### Catalog / List View Pattern
- [x] **Virtual scrolling** — `Table.jsx` supports `@tanstack/react-virtual`, auto-activates when data > 50 rows, per-row `<table>` layout with `colgroup` sync
- [ ] **Lazy-load on scroll** — fetch next batch from server as user scrolls near bottom (requires backend)
- [~] **Total record count** — implemented as table footer count bar (`RecordCount.jsx`) on all 13 list pages; not positioned next to search bar like Accurate
- [~] **Sticky column headers** — achieved in virtualized table mode (split header table + scrollable body); not uniformly sticky in non-virtualized mode
- [ ] **Server-side filtering** — date range, customer, status dropdowns filter via API (requires backend)
- [ ] **Server-side search** — search queries sent to backend (requires backend)
- [ ] **Skeleton rows** — show placeholder rows while next batch loads
- [~] Adopt for all catalogs — shared `Table` component applies to 13 pages; `InvoiceCatalogPanel` uses custom table (not yet migrated)

### Tabbed Document Workspace
- [x] **Tab bar** at top for open documents (like browser tabs)
- [x] Multiple invoices/documents open simultaneously as tabs
- [x] "Data Baru" (New) tab always available for quick creation
- [x] Tab close button (x) to dismiss individual documents
- [x] Tab count indicator
- [~] Pattern implemented across 6 pages (InvoiceWorkbench, AR Payments, AP Payments, CreditNotes, DebitNotes, Customers) but NOT standardized into shared components — each page re-implements tab logic independently
- [ ] Extract shared `useDocumentTabs` hook and `DocumentTabBar` component to eliminate duplication

### Customizable Dashboard
- [x] Per-user widget registry — 7 widgets: Cash on Hand, Overdue Invoices, Net Cash Flow (YTD), Outstanding Bills, Recent Invoices, Recent Payments, Recent Bills
- [x] RBAC-filtered widgets — each widget gated by its module permission (`banking`, `ar_invoices`, `ap_bills`, etc.)
- [x] Edit mode — add/remove widgets, config persisted per user in Zustand + localStorage
- [ ] Drag-and-drop widget reordering
- [ ] Date range filter across all dashboard widgets

### Module Landing Page (Grid Tiles)
- [x] Removed — tile-grid landing pages for AR/AP/HR/Inventory deleted (redundant with sidebar flyout)
- [x] Replaced with direct Navigate redirects: `/ar`→`/ar/invoices`, `/ap`→`/ap/bills`, `/hr`→`/hr/employees`, `/inventory`→`/inventory/items`

---

## Feature Comparison Summary: MSM vs ERPNext

| Module | MSM | ERPNext | Gap Level |
|--------|-----|---------|-----------|
| General Ledger / COA | Yes | Yes | Low |
| Journal Entries | Yes | Yes | Low |
| Accounts Receivable | Yes | Yes | Low |
| Accounts Payable | Yes | Yes | Low |
| AR/AP Payments | Yes | Yes | Low |
| Sales/Purchase Returns | Yes | Yes | Low |
| Purchase Orders | Yes | Yes | Medium |
| Inventory (basic) | Yes | Yes | Medium |
| Banking | Yes | Yes | Medium |
| Financial Reports | Yes | Yes | Medium |
| Tax (PPN) | Yes | Yes | Low |
| E-Commerce Integration | Partial | Full | High |
| Sales Orders | Yes (CRUD + Convert to Invoice + Print) | Yes | Low |
| Delivery Notes | No | Yes | **Critical** |
| Print / PDF | Yes (Invoice, Bill, PO, SO — A4 templates + CSV export) | Yes | Low |
| Inventory Valuation | No | Yes (FIFO/WA/LIFO) | **Critical** |
| Bank Statement Import | No | Yes | **Critical** |
| POS | No | Yes | **Critical** |
| CRM | No | Yes | High |
| HR & Payroll | Partial (Employee master data) | Yes | High |
| Asset Management | No | Yes | High |
| Manufacturing / BOM | Separate project (MSM Manufacturing) | Yes | N/A |
| Project Management | No | Yes | Medium |
| Multi-Company | No | Yes | Medium |
| Workflow Engine | No | Yes | Medium |
| REST API | Partial (internal Next.js API routes live for core modules; no public API key/docs yet) | Yes | Medium |
| Multi-User Auth | Partial (JWT login + httpOnly session + API middleware + protected routes; RBAC `/403` enforcement pending) | Yes | Medium |
| Budget Controls | No | Yes | Medium |
| Subscriptions | No | Yes | Medium |
| Quality Management | No | Yes | Low |
| Helpdesk / Support | No | Yes | Low |
| Loan Management | No | Yes | Low |
| Website Builder | No | Yes | N/A |

---

## Recommended Execution Order

```
v0.5.x — DB infrastructure done (PostgreSQL + Prisma schema applied; customizable dashboard done)
v0.6   — Print/PDF Export done (invoice/bill/PO A4 templates; CSV export on list pages)
v0.7   — Auth Foundation done + Sales Orders module done
          Login page + JWT httpOnly cookie sessions
          Next.js middleware protecting /api/v1/* routes (except /auth/*)
          Organization seed + admin user (admin@demo.com / admin123)
          ProtectedRoute — unauthenticated users redirected to /login
          Sales Order CRUD, 4-tab detail workbench, Convert to Invoice, A4 print template
          Report export to PDF & Excel, Print Preview Modal across transaction workbenches

v0.8   — Complete API Routes — all CRUD for all modules (Phase 1.1 cont.)
          AR: invoices, payments, customers (~12 routes)
          AP: bills, payments, vendors, POs (~12 routes)
          GL: journal entries, COA, periods (~8 routes)
          Inventory: items, warehouses, adjustments (~8 routes)
          Banking: accounts, transactions (~6 routes)
          HR: employees (~4 routes)
          Install React Query for async data layer.
          Backend `next build` green after Next 15 dynamic route signature updates
          Shopee bulk invoice import: 6-step wizard, Excel parser, item mapping, upsert

v0.9   — Frontend → Backend Connection (Phase 1.1 complete) ✓
          All 6 modules wired (reads + writes): Banking ✓ GL ✓ AR ✓ AP ✓ Inventory ✓ HR ✓
          13 list pages + 10 form pages on React Query; 4 sub-forms pending backend routes

v1.0   — Multi-User Auth live + all data in PostgreSQL ✓
          ↑ First production-ready release (Phase 1.1 + 2.4 complete)
          Audit log — logAudit() in all 38 API route handlers + AuditLogPanel UI
          RBAC route enforcement — PermissionRoute + Forbidden.jsx + App.jsx wiring
          Data migration tool — DataMigrationPanel in Settings (localStorage → PostgreSQL)
          Loading skeletons — SkeletonBlock + TableSkeleton components

v1.1   — Inventory Valuation + Bank Statement Import (Phase 1.4, 1.5)
v1.2   — Batch/Expiry Tracking (Phase 2.2)
v1.3   — Email Integration + Recurring Invoices (Phase 2.5, 2.3)
v1.4   — POS Module (Phase 2.1)
v1.5   — CRM (Phase 3.1)
v1.6   — E-Commerce Auto-Posting (Phase 3.5)
v1.7   — HR & Payroll full (Phase 3.2)
v1.8   — Asset Management + Budget Controls (Phase 3.3, 3.4)
v2.0   — Multi-Company + REST API + Workflow Engine (Phase 4)
         Manufacturing / BOM developed separately as MSM Manufacturing add-on
v3.0   — Domain-specific verticals (Phase 5)
```

---

*This roadmap is a living document. Update as features are completed or priorities change.*
