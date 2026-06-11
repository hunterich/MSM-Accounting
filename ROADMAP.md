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
  - Added missing CRUD for Accounting Periods, Departments, Positions, and Warehouses
  - Added reusable API helpers for pagination, centralized handler wrapping, and soft delete
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
- Reference flow spec: `docs/feature-flow-costing-and-fulfillment.md`
- [x] Sales Order CRUD (list, create, edit, view) — `SalesOrderWorkbench`, `SOForm`, tabbed detail panel
- [x] Sales Order → Invoice conversion (one-click) — `convertToInvoice()` in store; button on Confirmed/Delivered SOs
- [x] Sales Order status workflow (Draft → Confirmed → Delivered → Invoiced → Closed) — status badges + transitions
- [x] Printable Sales Order layout (A4) — `SalesOrderPrintTemplate.jsx`
- [x] Delivery Note generation from Sales Order — `DeliveryNote` + `DeliveryNoteLine` models; `/api/v1/delivery-notes` route (GET/POST); `DeliveryNotes.tsx` list view with create modal; DN confirmation updates `SalesOrderItem.deliveredQty` and SO status
- [x] Partial fulfillment tracking (qty delivered vs ordered) — `deliveredQty` + `invoicedQty` on `SalesOrderItem`; SO status progresses to DELIVERED when all lines fulfilled
  - Delivery Note updates delivered qty per line and shows remaining/backorder qty
  - Sales Order status supports partial delivery state before fully delivered/closed
  - Invoice conversion supports invoicing delivered qty now and remaining qty later

### 1.4 Inventory Valuation
- Reference flow spec: `docs/feature-flow-costing-and-fulfillment.md`
- [x] FIFO costing method — `InventoryLot` model tracks cost layers; `consumeFIFO()` in `lib/inventory-costing.ts` consumes oldest lots first
- [x] Weighted Average costing method — `getWeightedAverageCost()` calculates WA across open lots
- [x] First-login / onboarding choice for company costing method — wizard in CompanySetup.tsx when `org.costingMethod` is null
- [x] Settings option to switch costing method later with confirmation flow — "Change Method" modal with effective date picker and recalculation warning
- [x] Costing method switch recalculation from effective date with audit trail of the change — `/api/v1/inventory/recalculate-costing` collapses/recreates cost layers, creates audit journal entry, updates org settings
- [x] Perpetual inventory + transactional GL posting — every transactional route posts a balanced JournalEntry inside its own `prisma.$transaction` (PR #16):
  - Invoice DRAFT→SENT: `DR AR / CR Sales / CR Output Tax` *plus* `DR COGS / CR Inventory` (per inventory line)
  - Bill POST: one JE per bill — `DR Inventory + DR Expense + DR Input Tax / CR AP` (replaces prior per-line posting; service lines now included)
  - AR Payment: `DR Bank / CR AR`; AP Payment: `DR AP / CR Bank`
  - Credit Note: `DR Sales Returns / CR AR`; Debit Note: `DR AP / CR Purchase Returns`
  - Stock Adjustment: writes `InventoryLedgerEntry` rows *plus* `DR Inventory / CR Variance` (or reverse) — perpetual ledger was unwritten before
  - Shared helper `lib/journal-posting.ts:postJournalEntry` enforces debits = credits on every post
  - Trial-balance smoke verified: `SUM(debit) − SUM(credit) = 0` across POSTED entries
- [x] Sales Returns / Purchase Returns GL posting — `lib/sales-return-posting.ts` / `lib/purchase-return-posting.ts` post inventory legs on approval; wired into both routes
- [x] Tax-amount split on Credit / Debit Notes — `taxAmount` column added; posting splits DR/CR across arTax (Output Tax) / apTax (Input Tax) on apply; forms send the computed PPN portion
- [ ] Account Defaults expansion (Accurate-style): split the flat list into 4 sub-tabs (Barang & Jasa / Perusahaan / Penjualan-Pembelian / Persediaan); add `inventoryAdjustment`, `stockVariance`, `roundingAccount`, `salesDiscount`, `purchaseDiscount`, `openingBalanceEquity`, `retainedEarnings`, `incomeTaxExpense` (today the new postings fall back to `cogsExpense` for unmatched cases)
- [x] COGS auto-calculation on invoice line items — `calculateAndPostCOGS()` called per inventory line on DRAFT→SENT transition (CPA timing fix)
- [x] Stock valuation report — `/api/v1/inventory/valuation` route + `StockValuation.tsx` view with category/warehouse filters and Excel export

### 1.5 Bank Statement Import & Reconciliation
- [x] CSV / OFX bank statement import — `lib/bank-statement-parser.ts` auto-detects format; `/api/v1/bank-statements` POST stores BankStatement + lines
- [x] Auto-matching rules (by amount, reference, date) — `/api/v1/bank-statements/match` matches by amount (±0.01) and date (±3 days)
- [x] Manual match/unmatch interface — `PUT /api/v1/bank-statements/[lineId]` + Banking.tsx import panel with per-line match actions
- [x] Reconciliation summary report — `/api/v1/reports/banking?type=reconciliation-summary`; `BankReconciliation.tsx` view; book balance vs statement balance + matched/unmatched counts per account
- [x] Payment reconciliation against bank transactions — `/api/v1/reconciliation/payments` auto-matches AR/AP payments to bank txns; `PaymentReconciliation.tsx` with manual match UI

### 1.6 Data Import / Export
- [x] CSV import for customers, vendors, items, COA, opening balances — `CsvImportPanel.tsx` in Settings (CSV Import tab); `/api/v1/import/[entity]` route with dry-run; 7 entity types including opening journals, invoices, bills
  - [x] Opening balance fields on customer/vendor/item CSV templates (openingBalance, openingStock, openingValue)
  - [x] Opening Balance Journal import — CSV with accountCode/debit/credit, auto-validates balanced journal, creates POSTED `source=OPENING` JournalEntry
  - [x] Opening AR Invoices import — import old unpaid invoices with original dates, matched by customerName, created as POSTED
  - [x] Opening AP Bills import — import old unpaid bills with original dates, matched by vendorName, created as APPROVED
- [x] CSV export for all list views — `exportToCsv` utility added to 18+ list pages (Customers, Vendors, Payments, POs, COA, Journal Entries, Inventory, Employees, etc.)
- [~] Bulk invoice import from marketplace exports — Shopee + TikTok Shop done via the shared 6-step wizard (`ImportInvoicesModal.tsx` + multi-platform parser in `shopeeImport.ts`); Tokopedia / Lazada not started
- [x] PDF bill import — upload supplier invoice PDF → extract text → auto-match vendor + items → review → create bill (`lib/bill-imports.ts` + `/api/v1/bill-imports/` routes)
- [~] Faktur (purchase invoice) image import — OCR-based extraction from scanned faktur images to Accurate-style purchase invoice import format
  - [ ] Image upload endpoint (JPEG/PNG/TIFF) with size validation
  - [ ] OCR text extraction (Tesseract.js or cloud OCR API)
  - [ ] Indonesian faktur field parser (nomor faktur, NPWP, DPP, PPN, tanggal)
  - [ ] Auto-match vendor by NPWP or name
  - [ ] Auto-match items by supplier SKU / description
  - [ ] Review UI with line-item editing before import
  - [ ] Export to Accurate-compatible Excel format (optional)
  - [ ] Batch upload support (multiple faktur images at once)

### 1.7 Financial Reporting Foundation
- [x] Reporting workspace exists with Sales and AR reports, print view, and CSV export
- [x] GL financial statements in Reports module — Trial Balance, Balance Sheet (standard + multi-period comparison), and Profit & Loss fully implemented in `src/app/api/v1/reports/gl/route.ts` and `src/views/reports/Reports.tsx`; `lib/gl-reporting.ts` migrated to TypeScript
- [x] AP aging and vendor balance reports — `/api/v1/reports/ap` with type=aging/vendor-balance/overdue-list; APAging.tsx now API-driven
- [x] Cash / bank movement reports — `/api/v1/reports/gl?type=cash-flow` with inflow/outflow per bank account
- [x] Inventory stock movement and valuation reports — `/api/v1/reports/gl?type=stock-movement` + `/api/v1/inventory/valuation`; all three new reports added to Reports.tsx

### 1.8 Operational Controls & API Hardening
- [x] Pagination on high-risk list endpoints (accounts, items, customers, vendors, employees)
- [x] Accounting period CRUD + close/lock action
- [x] Department and Position CRUD
- [x] Warehouse CRUD
- [x] Soft delete for master data
  - Customers, vendors, employees, and items now deactivate instead of hard deleting
  - Bank accounts, item categories, and vendor categories now also deactivate instead of hard deleting
  - SalesInvoice and Bill: `deletedAt DateTime?` added to schema; DELETE routes soft-delete; GET list routes filter `deletedAt: null`
- [x] Credit limit enforcement on invoice and sales-order creation
- [x] Validation + org-scoped FK checks for bills, purchase orders, AR payments, and AP payments
- [x] Validation + org-scoped FK checks for sales orders, stock adjustments, and bank transactions
- [x] Centralized route error-handling utility
  - `withHandler()` wrapper adopted across all route files
  - `requireOrg()` / `requireAuth()` helpers eliminate manual header checks
  - Handles `ApiError`, `AccessError`, `CreditLimitError`, and Prisma errors
  - `logAuditTx()` added for transactional audit logging
- [x] SQL injection hardening — `nextNumber()` uses hardcoded queries per table (no string interpolation)
- [x] Request body size limits — 10 MB cap in next.config.mjs
- [x] Shared monetary utilities — `lib/money.ts` (toNumber, asMoney, roundMoney) replaces duplicate definitions

---

## Phase 2 — Business Critical (Revenue Impact)

> Goal: Features required by target market (beauty clinics, pharmacies, e-commerce sellers).
> Note: POS and pharmacy/cosmetics batch-expiry are now tracked as optional add-on modules so the core accounting roadmap stays focused.

### 2.1 POS (Point of Sale) — Moved to Add-On Module
- [ ] Retail / cashier workspace to be delivered as an optional add-on
- [ ] Covers barcode sales flow, receipt printing, payment capture, and end-of-day closing

### 2.2 Batch & Expiry Tracking — Moved to Add-On Module
- [ ] Pharmacy / cosmetics inventory add-on for batch, expiry, FEFO, and compliance fields
- [ ] Includes batch-level stock visibility, expiry alerts, and controlled picking on stock movements

### 2.3 Recurring Invoices / Subscriptions
- [x] Recurring invoice templates (monthly, quarterly, annual) — `RecurringInvoices.tsx` + `/api/v1/recurring-invoices` CRUD
- [x] Auto-generation schedule — `/api/v1/recurring-invoices/run` batch endpoint + per-template `Generate Now`
- [x] Subscription plans with trial period — `SubscriptionPlan` model + CRUD API; trial days configurable per plan
- [x] Subscription status lifecycle (Trialing, Active, Past Due, Cancelled, Expired) — `Subscription` model + status transitions
- [x] Pro-rata billing on cancellation — `lib/subscription.ts` calculates refund based on days remaining in period
- [x] Subscription invoice auto-generation — `/api/v1/subscriptions/generate-invoices` batch endpoint
- [x] Subscriptions UI — `Subscriptions.tsx` with tab layout (Subscriptions | Plans), full CRUD, cancel with refund display

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
- [x] Master/Categories permission split — `ar_customers` ("Customers Master") + `ar_customer_categories`, `ap_vendors` ("Vendors Master") + `ap_vendor_categories` so a user can be denied the master without losing categories (and vice versa)
- [x] Per-module action flags beyond CRUD — `ModulePermission` extended with optional flags (`reprint`, `overridePrice`, `sellBelowCost`, `invoiceWithoutSO`); `MODULE_EXTRA_ACTIONS` metadata + `useExtraAction(moduleKey, action)` hook; rendered as indented sub-rows in the role editor; gates Print buttons + line-price input + invoice-without-SO save

### 2.5 Email Integration
- [x] Send invoice PDF to customer via email — `/api/v1/invoices/[id]/send-email`; updates status to SENT + audit log
- [x] Automated payment reminders (overdue invoices) — `/api/v1/email/reminders` batch endpoint
- [~] Notification toggle exists in settings but not wired
- [x] Send PO to vendor via email — `/api/v1/purchase-orders/[id]/send-email`
- [x] Email templates (customizable) — `EmailTemplate` model + CRUD API; `EmailTemplates.tsx` in Settings; `lib/email.ts` renders templates with `{{variable}}` substitution; fallback to hardcoded HTML; 3 default templates (Invoice, Reminder, PO)

### 2.6 Vendor Categories
- [x] Vendor category CRUD (like Customer Categories)
- [x] Category-specific defaults (payment terms, GL account)
- [x] Filter vendors by category

### 2.7 Accounting Governance
- [x] Settings IA: Features / Restrictions / Approval Rules tabs (Accurate-style)
  - **Features tab** — org-wide on/off toggles for whole modules (Sales Orders, Sales Returns, Recurring, Subscriptions, Delivery Notes, Customer/Vendor Categories, Approvals, Shop Integrations, Purchase Orders, Item Categories, Fixed Assets, HR & Payroll, Tax). Disabled modules disappear from the sidebar for everyone. `useSettingsStore.features` + `SUBITEM_FEATURE_MAP` in `Sidebar.tsx`
  - **Restrictions tab** — single home for org-wide rules (`enforceLimit`, `blockSellBelowCost`, `requireSalesOrder`); moved out of Customers & Sales tab so policies don't mix with master defaults
  - **Approval Rules tab** — per-module require-approval toggles (10 modules across AR/AP/Inv/HR). Phase 1 = configuration persists; save-time enforcement per form is a follow-up
- [x] Credit limit enforcement using outstanding AR balance + new document amount
- [x] Approval workflow for invoices / purchase orders — `ApprovalInbox.tsx`; submit/approve/reject routes for invoices + POs; `ApprovalRequest` model; `PENDING_APPROVAL` status on invoice/PO
- [x] Payment reconciliation against bank transactions — `/api/v1/reconciliation/payments` auto-match + manual match; `PaymentReconciliation.tsx`
- [x] Accounting period close checklist and reopen flow — `/api/v1/accounting-periods/[id]/close-checklist` health check + `/close` blocks on unposted journals
- [x] **CPA Audit Controls**: Document immutability (block edit/delete on non-DRAFT), COGS timing fix (post on SENT), BillStatus APPROVED enum, payment allocation validation
- [ ] Save-time enforcement of `approvalRequirements` toggles in each form (current Phase 1 only persists the config; forms still create records directly without checking the require-approval flag)

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
- [x] **Employee Master Data:**
  - [x] Personal info (Name, KTP, DOB, Contact, Address)
  - [x] Employment details (Join Date, Department, Job Title, Employment Status)
  - [x] Bank details (Bank Name, Account Number, Account Holder)
  - [x] Government IDs (NPWP, BPJS Kesehatan, BPJS Ketenagakerjaan)
  - [x] Salary Structure (Basic Salary, Default Allowances, Default Deductions)
- [x] **Attendance & Leave Management:**
  - [x] Time tracking / Daily attendance (manual entry + bulk entry) — `Attendance.tsx` with calendar date strip, status filter, bulk entry modal; `/api/v1/attendance` CRUD with upsert
  - [x] Leave types (Annual, Sick, Maternity, Paternity, Unpaid, Other) — `LeaveType` model + CRUD; configurable entitlement + carry-over
  - [x] Leave balance management — `LeaveBalance` model per employee/year; auto-initialized with carry-over; `/api/v1/leave-balances` API
  - [x] Leave request workflow (submit → approve/reject) — `LeaveRequest` model; balance validation on submit; balance decrement on approve; `LeaveManagement.tsx` with 3-tab layout
- [x] **Payroll Processing & Generation:**
  - [x] Monthly batch run (generate payslips for all active employees) — `PayrollRun` + `PayrollLine` models; `/api/v1/payroll-runs/[id]/calculate` batch endpoint
  - [x] Variable component entry (Overtime hours, Allowances, Deductions per employee)
  - [x] PPh 21 Tax calculation (TER 2024 rates) — `lib/payroll-calc.ts` with full bracket tables for categories A/B/C up to 1.4B/month
  - [x] BPJS calculations (Employer vs Employee portions) — Kesehatan (1%/4%), JHT (2%/3.7%), JP (1%/2%), JKK (0.24%), JKM (0.3%) with 2024 ceilings
  - [x] Payroll Run UI — `PayrollRun.tsx` with summary cards (gross/deductions/tax/BPJS/net), employee line detail table, CSV export
  - [ ] Salary slip PDF generation
- [x] **Accounting Integration:**
  - [x] Auto-post Payroll Summary Journal Entry upon approval — `/api/v1/payroll-runs/[id]/post` creates JE (Debit Salary Expense, Credit Cash + Tax Payable + BPJS Payable)

### 3.3 Asset Management
- [x] Fixed asset register — `AssetRegister.tsx` with search, category/status filters, summary cards (total assets, cost, book value); `/api/v1/assets` CRUD with auto-generated ASSET-XXXXXX numbers
- [x] Asset categories (Furniture, Equipment, Vehicle, etc.) — `AssetCategory` model with depreciation defaults; `AssetCategories.tsx` CRUD UI
- [x] Depreciation methods (Straight Line, Declining Balance, Double Declining) — `lib/depreciation.ts` with salvage value floor; configurable per asset or category default
- [x] Automated monthly depreciation journal entries — `/api/v1/assets/depreciation/run` batch processes all ACTIVE assets; creates `AssetDepreciation` records + GL journal entries (Debit Depreciation Expense, Credit Accumulated Depreciation); auto-marks FULLY_DEPRECIATED
- [x] Asset disposal / write-off — `/api/v1/assets/[id]/dispose` calculates gain/loss; creates journal entry (Debit Cash + Accum Dep, Credit Asset + Gain/Loss); `AssetDetail.tsx` disposal modal with gain/loss preview
- [x] Asset movement tracking (location, custodian, department, serial number)
- [ ] Asset maintenance schedule

### 3.4 Budget Controls
- [ ] Budget definition per GL account / cost center / department
- [ ] Budget periods (monthly, quarterly, annual)
- [ ] Budget vs Actual report
- [ ] Budget enforcement modes: Warn, Block, or Silent
- [ ] Budget variance alerts

### 3.5 E-Commerce Auto-Posting
- [~] Shop connections + per-shop settings in `useIntegrationStore.js`; Integrations.jsx manages shop list
- [~] Auto-import orders: Shopee + TikTok Shop done (shared 6-step wizard, Excel parse, item mapping, upsert by Order ID); Tokopedia / Lazada not started
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

## Add-On Modules

> Optional modules that extend MSM for specialized operating models without bloating the core accounting workspace.

### A1. Retail POS Add-On
- [ ] Browser-based POS interface
- [ ] Product search + barcode scanning
- [ ] Cart with qty adjustment, discount per line
- [ ] Multiple payment methods (cash, card, QRIS, split payment)
- [ ] Cash change calculation
- [ ] Receipt printing (thermal printer support)
- [ ] POS closing / end-of-day summary
- [ ] Offline mode with sync (localStorage fallback)
- [ ] POS Profile per user / warehouse

### A2. Pharmacy & Cosmetics Compliance Add-On
- [ ] Batch number field on inventory items
- [ ] Expiry date per batch
- [ ] Expiry alerts (30 / 60 / 90 day warnings)
- [ ] FEFO picking (First Expiry, First Out)
- [ ] Batch selection on invoice / PO / stock movements
- [ ] BPOM / product registration number field
- [ ] Batch-level stock report

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
- [~] Batch & expiry now tracked under Add-On Modules (A2)
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
| Add TypeScript | [x] Full-stack TypeScript — all 96 frontend JS/JSX files migrated to TS/TSX; `src/types/index.ts` shared frontend interfaces created; `@types/xlsx`, `@types/jspdf`, `@types/file-saver`, `@types/pdf-parse` installed; 0 tsc errors, 88/88 tests passing | Medium |
| Unit tests for stores & utils | [x] 104 tests across 17 files; AR/AP validation + reports + route isolation tests added | High |
| E2E tests (Playwright/Cypress) | [x] Playwright installed; `e2e/auth.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/invoices.spec.ts`; `npm run test:e2e` | Medium |
| Error boundaries & error handling | [x] ErrorBoundary component with page/widget variants; wraps App, Dashboard, and each widget | High |
| Loading states & skeleton screens | [~] `LoadingSkeleton.jsx` (`SkeletonBlock`, `TableSkeleton`) added; not yet applied to all pages | Medium |
| Mobile responsive layout | [x] Mobile top nav bar (hamburger + slide-over); sidebar hidden on mobile; dashboard widgets responsive grid; tables overflow-x-auto; filter bars flex-wrap | Medium |
| Accessibility (a11y) audit | Not started | Low |
| Virtual scrolling / lazy-load for large lists (Accurate pattern) | [~] Table.jsx supports @tanstack/react-virtual (auto >50 rows), record count footer on all list pages | **Critical** |
| Performance optimization (large datasets) | Not started | Medium |
| i18n framework (proper ID/EN switching) | Not started | Low |
| CI/CD pipeline | [x] `.github/workflows/ci.yml` — GitHub Actions: tsc + vitest + prisma db push on every push/PR; Vercel deploy via GitHub integration | Medium |
| Backup & restore functionality | Not started | High |
| API route hardening | [x] `withHandler()` + `requireOrg()`/`requireAuth()` across all routes; `@ts-nocheck` removed; duplicate utility functions consolidated; FNV-1a advisory lock hashing; body size limits | **Critical** |
| Duplicate file cleanup | [x] Removed `apiClient.js` (kept `.ts`), `useAuthStore.js` (kept `.ts`) | Medium |
| Frontend TypeScript migration | [x] Complete — 96 files converted (all views, components, utils, hooks, tests); only `mockData.js` and `vite.config.js` intentionally kept as JS | Medium |

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
- [x] Extract shared `useDocumentTabs` hook and `DocumentTabBar` component to eliminate duplication — `src/hooks/useDocumentTabs.ts` + `src/components/UI/DocumentTabBar.tsx`; InvoiceWorkbench, Payments, CreditNotes refactored

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
| Financial Reports | Partial | Yes | Medium |
| Tax (PPN) | Yes | Yes | Low |
| E-Commerce Integration | Partial | Full | High |
| Sales Orders | Yes (CRUD + Convert to Invoice + Print) | Yes | Low |
| Delivery Notes | Yes (DN from SO, delivered qty tracking) | Yes | Low |
| Print / PDF | Yes (Invoice, Bill, PO, SO — A4 templates + CSV export) | Yes | Low |
| Inventory Valuation | Yes (FIFO/WA, cost layers, stock valuation report) | Yes (FIFO/WA/LIFO) | Low |
| Bank Statement Import | Yes (CSV/OFX, auto-match, reconciliation report) | Yes | Low |
| POS | No | Yes | **Critical** |
| CRM | No | Yes | High |
| HR & Payroll | Yes (Employee + Attendance + Leave + Payroll with PPh 21 + BPJS + GL posting) | Yes | Low |
| Asset Management | Yes (Register + Categories + Depreciation SL/DB/DDB + Disposal + GL) | Yes | Low |
| Manufacturing / BOM | Separate project (MSM Manufacturing) | Yes | N/A |
| Project Management | No | Yes | Medium |
| Multi-Company | No | Yes | Medium |
| Workflow Engine | No | Yes | Medium |
| REST API | Partial (internal Next.js API routes live for core modules; no public API key/docs yet) | Yes | Medium |
| Multi-User Auth | Yes (JWT + httpOnly session + API middleware + RBAC route enforcement + document-level perms + audit log) | Yes | Low |
| Faktur Import (OCR) | Planned (image → OCR → bill) | N/A (Accurate feature) | High |
| Budget Controls | No | Yes | Medium |
| Subscriptions | Yes (Plans + Lifecycle + Pro-rata + Invoice Generation) | Yes | Low |
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

v1.0.1 — Code Quality & Hardening
          API route migration to withHandler() + requireOrg()/requireAuth()
          Remove @ts-nocheck from all route files
          Shared lib/money.ts (toNumber, asMoney, roundMoney)
          FNV-1a advisory lock hashing + hardcoded SQL queries (no interpolation)
          Transactional audit logging (logAuditTx)
          Request body size limits (10 MB)
          Duplicate file cleanup (apiClient.js, useAuthStore.js)
          Faktur/purchase invoice image import (OCR → bill creation)

v1.1   — Inventory Valuation + Bank Statement Import (Phase 1.4, 1.5) ✓
          Costing method switch recalculation with audit trail
          Bank reconciliation summary report
          CSV export on all list pages + CSV import tool in Settings (7 entity types)

v1.2   — Recurring Invoices + Subscriptions + Email Templates (Phase 2.3, 2.5) ✓
          Recurring invoice templates (monthly/quarterly/annual) + auto-generation
          Subscription plans with trial periods + pro-rata billing + lifecycle
          Customizable email templates (invoice, payment reminder, PO)
          Approval workflow for invoices & POs (Phase 2.7)

v1.3   — CPA Audit Controls + Soft Delete (Phase 1.8) ✓
          Document immutability (only DRAFT editable/deletable)
          COGS posting on DRAFT→SENT (not at creation)
          Payment allocation validation (no over-allocation)
          Soft delete for invoices & bills (deletedAt)

v1.4   — HR & Payroll full (Phase 3.2) ✓
          Attendance tracking (daily entry, bulk import, calendar view)
          Leave management (types, requests, approval, balances)
          Payroll run (PPh 21 TER 2024, BPJS, overtime, proration)
          Payroll GL journal posting (salary expense, tax/BPJS liabilities)

v1.5   — Asset Management (Phase 3.3) ✓
          Fixed asset register + categories
          Depreciation: Straight Line, Declining Balance, Double Declining
          Asset disposal with gain/loss calculation
          Automated monthly depreciation journal entries

v1.6   — Payment Reconciliation (Phase 2.7 cont.) ✓
          Two-panel match UI (bank transactions vs AR/AP payments)
          Auto-match suggestions + manual match/unmatch

v1.7   — Batch/Expiry Tracking (Phase 2.2)
v1.8   — POS Module (Phase 2.1)
v1.9   — CRM (Phase 3.1)
v2.0   — E-Commerce Auto-Posting + Budget Controls (Phase 3.4, 3.5)
v3.0   — Multi-Company + REST API + Workflow Engine (Phase 4)
         Manufacturing / BOM developed separately as MSM Manufacturing add-on
v4.0   — Domain-specific verticals (Phase 5)
```

---

*This roadmap is a living document. Update as features are completed or priorities change.*
