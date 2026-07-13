# Data Migration & Onboarding Wizard (Accurate Online → MSM)

**Date:** 2026-07-13
**Status:** Design approved, pending implementation plan
**Branch:** `claude/data-migration-old-system-ffa2d6`

## Problem

The app has the building blocks to onboard a company from a legacy accounting
system (master-data CSV import, opening-journal, opening-invoices/bills, opening
stock), but there is no guided flow that ties them together, and using them
naively **double-counts** control-account balances. There is also no safe,
reversible way to run a migration against a live GL.

The concrete source system is **Accurate Online** (the SaaS this app clones).
Its exports are known and stable enough to map against.

## Scope

**In scope — clean cutover:**
- Master data: Chart of Accounts, Customers, Suppliers, Items.
- Opening balances as of a single **cutover date**: trial balance (GL),
  open AR invoices, open AP bills, opening stock (qty + value).
- A guided **wizard** with column mapping, staging, reconciliation, atomic
  commit, and one-click rollback.

**Out of scope (explicitly):**
- Bulk import of full historical transaction detail (past posted invoices,
  bills, journals, payments). The old system stays available read-only for
  history. Design is opening-balance carry-forward only.
- Non-Accurate source systems (the column-mapping approach keeps the door open,
  but only Accurate is targeted/tested now).
- Price-list import.

## The core accounting model (avoid double-counting)

A trial balance already contains the AR control, AP control, and Inventory asset
totals. The existing `opening-stock` path **posts to the GL**, and an
`opening-journal` that includes those accounts would post them **again** →
control accounts doubled.

**Migration posting model:**

1. **Trial Balance** → posted as the single opening journal (`source: OPENING`).
   Sets every GL account balance. It already balances against Opening Balance
   Equity, so nothing else touches the GL.
2. **Open AR invoices / AP bills / opening stock** → created as **subledger +
   inventory lots only, with NO GL posting** (a new "migration mode"), because
   the TB already carried those totals.

**Four reconciliation checks — commit is blocked unless all pass:**

1. TB total debits = TB total credits.
2. Σ open AR invoice balances = AR control account balance in the TB.
3. Σ open AP bill balances = AP control account balance in the TB.
4. Σ opening stock value = Inventory asset account balance in the TB.

This produces a balanced cutover whose subledger detail ties exactly to the GL.

## Source → target data map

| Accurate export | → import entity | Notes |
|---|---|---|
| Daftar Akun (Chart of Accounts) | `accounts` | Must preserve account type + parent hierarchy (current import is flat — gap to fix). |
| Daftar Pelanggan (Customers) | `customers` | direct |
| Daftar Pemasok (Suppliers) | `vendors` | direct |
| Daftar Barang (Items) | `items` | prices, unit, category |
| Neraca Saldo (Trial Balance @ cutover) | `opening-journal` | one balanced journal = whole GL opening |
| Umur Piutang (AR aging) / open invoice list | `opening-invoices` | subledger only (migration mode) |
| Umur Hutang (AP aging) / open bill list | `opening-bills` | subledger only (migration mode) |
| Stock valuation report | item `openingStock` / `openingValue` | lots only (migration mode) |

## Wizard flow

Each step: **upload Accurate export → map columns → preview + validate → stage.**
Nothing hits the live books until Commit (Step 7).

- **Step 0 — Start:** pick target company (must be fresh / no transactions after
  cutover); set cutover date; create the migration batch.
- **Steps 1–4 — Master data:** Chart of Accounts, Customers, Suppliers, Items.
- **Step 5 — Opening balances:** 5a Trial Balance (sets GL totals), 5b Open AR
  (detail), 5c Open AP (detail), 5d Opening stock (detail).
- **Step 6 — Review & Reconcile:** show the four checks with green/red status and
  side-by-side totals. **Red disables Commit.**
- **Step 7 — Commit:** all staged rows written in one transaction, each stamped
  with `migrationBatchId`.
- **Step 8 — Done:** summary; run the live Trial Balance report as-of cutover and
  show it matching the imported TB (built-in verification); offer **Roll back**.

Design choices:
- **Resumable** — staging is server-side, so a half-finished migration survives.
- **Gated order** — opening balances can't run before the master data they attach
  to exists.

## Staging, batch & rollback

**`MigrationBatch` model** (new): company, cutover date, status
(`DRAFT → COMMITTED → ROLLED_BACK`), createdBy, counts/totals, and the staged
rows (parsed JSON) for each step.

**Staging:** steps 1–5 store mapped+validated rows on the batch, not as real
records. The Step 6 reconciliation runs against staged data.

**Commit:** one DB transaction turns staged rows into real records; every created
record is stamped `migrationBatchId`.

**Rollback:** deletes all records carrying that `migrationBatchId` in reverse
dependency order (opening docs & lots → journal → items/customers/vendors →
accounts). Guardrails:
- **Blocked if anything new has been posted on top** (real transactions after
  cutover referencing these records) — the wizard explains why.
- Recorded as `ROLLED_BACK` for audit.

**Schema impact:** adds `MigrationBatch` + a nullable `migrationBatchId` column on
affected tables → **Prisma migration required at deploy.**

## Reuse vs. new

**Reuse:**
- xlsx parsing — `src/utils/shopeeImport.ts`.
- Column-mapping UI pattern — `src/components/ar/invoices/ImportInvoicesModal.tsx`.
- Import entities & validation — `src/app/api/v1/import/[entity]/route.ts`.
- Opening-stock posting — `lib/inventory-opening.ts` (in migration mode).
- Company bootstrap (COA + Opening Balance Equity) — `lib/organization/bootstrap.ts`.
- Live Trial Balance report (verification) — `lib/gl-reporting.ts`
  (`buildTrialBalanceReport`), `src/app/api/v1/reports/gl/route.ts`.

**New:**
1. Migration-mode flag on opening-stock / opening-AR / opening-AP (detail, no GL).
2. Reconciliation engine — pure function (staged TB + AR + AP + stock → four check
   results).
3. `MigrationBatch` model + `migrationBatchId` stamping + staging store.
4. Rollback service with the "nothing posted on top" guard.
5. Wizard UI (stepper).
6. Chart-of-Accounts import: preserve account type + parent hierarchy.

## Testing

- **Unit:** reconciliation engine (balanced; off-by-AR; off-by-stock; empty).
- **Integration (real Postgres, existing GL-invariant harness):**
  - Full migration → assert live Trial Balance report as-of cutover == imported
    TB; AR/AP subledger ties to control; inventory ties to control.
  - Rollback → company empty again.
  - Rollback blocked after a post-cutover transaction exists.

## Open items / follow-ups (not blocking)

- Exact Accurate export column layouts to seed default mapping presets (reduce
  mapping clicks). Gather real export samples during implementation.
- Bank-account-specific opening balance entry (currently flows through the
  opening journal) — acceptable for v1.
