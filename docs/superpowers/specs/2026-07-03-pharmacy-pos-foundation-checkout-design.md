# Pharmacy POS — Slice 1: Foundation + OTC Checkout — Design Spec

**Date:** 2026-07-03
**Status:** Draft for review
**Source plan:** `Pharmacy POS/Pharmacy_Clinic_POS_Plan.docx` (rev. 2)
**Builds inside:** MSM Accounting Software monorepo (this repo)

---

## 1. Context & decisions

We are building a Pharmacy + Clinic POS for an Indonesian apotek+klinik. Rather than fork an
open-source pharmacy repo or build a standalone app, the POS is built **inside the MSM Accounting
monorepo**, reusing its Prisma schema, PostgreSQL database, posting engine, and auth. A sale posts
straight into the GL and inventory with no export, re-keying, or reconciliation.

MSM is **multi-tenant** and already serves multiple companies (e.g. a Cultusia e-commerce org and the
Pharmacy & Clinic org) as separate `Organization`s in one app + database. The POS is used by the
pharmacy org **only**; it must not affect other orgs. MSM's existing org-scoping + RBAC module gating
+ separate PWA entry make this isolation automatic (see §9).

Decisions locked during brainstorming:

| Decision | Choice |
|----------|--------|
| Who builds | Haely + Claude, largely solo |
| Foundation | Build fresh (no fork) |
| Stack | End-to-end TypeScript — mirrors MSM: Vite + React 19 + Tailwind + TanStack Query frontend, Next.js App-Router API, Prisma + PostgreSQL |
| Integration model | Monorepo module inside MSM, sharing one schema + the posting engine |
| Multi-company isolation | POS gated behind a `POS_RETAIL` module key, enabled for the pharmacy org only; own PWA entry; org-scoped data. Other orgs (Cultusia) unaffected |
| Batch/expiry | Dedicated `StockBatch` layer (separate from MSM's costing lots) |
| Payments (slice 1) | **Cash only.** Tender model kept generic so QRIS / e-wallet / EDC slot in later with no migration |
| POS app shape | Its own offline-first PWA entry (`pos.html`), not a route in the back-office SPA |
| SATUSEHAT | Deferred (plan Phase 6) — not in scope |

**What MSM already provides (reused, not rebuilt):** `Item`, `ItemCategory`, `Warehouse`,
`InventoryLedgerEntry`, `InventoryLot` (cost layers), FIFO/weighted-average costing + COGS posting
(`lib/inventory-costing.ts`), `SalesInvoice`/`SalesInvoiceLine`, `ARPayment`/`ARPaymentAllocation`,
`Account`/`JournalEntry`/`JournalLine`, `postInvoiceSend` (`lib/invoice-send-posting.ts`),
`postJournalEntry`, org account defaults, period guard, RBAC (`Role`/`RolePermission`/`ModuleKey`),
per-org subscriptions/module gating, JWT cookie auth (`msm_token`).

## 2. Scope of this slice

**In scope — a cashier can reliably ring up an over-the-counter (non-prescription) cash sale:**

1. POS PWA scaffolded as its own Vite entry inside the repo, offline-first, gated by `POS_RETAIL`.
2. Pharmacy roles (Cashier, Pharmacist/APJ) + the `POS_RETAIL` module permission via existing RBAC.
3. Shared-inventory schema additions that are painful to retrofit: `StockBatch` (batch + expiry),
   `Item.drugClass` field, batch reference on stock movements. **FEFO picking** on sale.
4. Keyboard/barcode-first checkout: cart, quantity, line discount, hold/resume.
5. **Cash** payment with change calculation. Tender persisted via a generic `PosTender` whose method
   enum already defines future values (QRIS/e-wallet/EDC) but only `CASH` is selectable now.
6. Sale posts natively: creates `SalesInvoice` (SENT) + `ARPayment` (cash) + decrements `StockBatch`,
   in one `$transaction`, via the existing `postInvoiceSend` + costing engine.
7. Thermal receipt (58/80mm) + digital receipt payload.
8. Shift & cash drawer: open/close, opening float, cash count, expected-vs-actual variance, Z-report.
9. Offline resilience: cash sales complete offline, queue in IndexedDB, sync when online.
10. Bahasa Indonesia default via an i18n layer.

**Explicitly OUT of scope (later slices):** all non-cash payments — **QRIS (static and dynamic),
e-wallet, EDC card integration**; drug-class *enforcement*/Rx blocking, e-resep capture, pharmacist
(APJ) authorization workflow, controlled-substance register, compounding (racikan), clinic→pharmacy
MedicationRequest flow, etiket/dosage-label printing, loyalty/membership, multi-branch UI, SATUSEHAT
sync, accounting *export* (native posting replaces it). The `drugClass` **field** and batch/expiry
**schema** land now; their **workflows** are slice 2+.

## 3. Architecture

```
MSM repo
├── prisma/schema.prisma          + StockBatch, PosShift, PosSale, PosTender, PosRegister(light)
│                                  + Item.drugClass, Item.requiresBatchTracking
│                                  + InventoryLedgerEntry.batchId
│                                  + ModuleKey.POS_RETAIL
│                                  + enums (DrugClass, PosShiftStatus, PosTenderMethod, PosSaleSyncStatus)
├── lib/
│   ├── invoice-send-posting.ts   (reused unchanged)
│   ├── inventory-costing.ts      (reused unchanged)
│   └── pos/                       NEW
│       ├── fefo-picker.ts        earliest-expiry batch selection
│       ├── tender.ts             tender validation + change (cash now; extensible)
│       ├── sale-posting.ts       orchestrates SalesInvoice+ARPayment+StockBatch in one tx
│       └── shift.ts              open/close, expected cash, variance, Z-report aggregation
├── src/app/api/v1/pos/           NEW route handlers (guarded by POS_RETAIL permission)
│   ├── sales/route.ts            POST create+post sale (idempotent on clientSaleId)
│   ├── shifts/route.ts           POST open · shifts/[id]/close
│   ├── catalog/route.ts          GET catalog snapshot for offline cache
│   └── registers/route.ts        GET/POST register (till) config
└── src/pos/                      NEW offline-first PWA (loaded only by pharmacy-org cashiers)
    ├── pos.html + manifest + service worker (vite-plugin-pwa / Workbox)
    ├── db/ (Dexie IndexedDB: catalog cache + outbound sale queue)
    ├── sync/ (background replay of queued sales)
    ├── views/ (Checkout, ShiftOpen, ShiftClose/Z-report, Receipt)
    └── i18n/ (id default, en fallback)
```

**Clinic vs. pharmacy** = two `Warehouse` rows in the single pharmacy Organization. Each POS register
is bound to a warehouse; sales relieve stock from that warehouse.

## 4. Data model

New models (fields abbreviated; all carry `organizationId`, timestamps, and org-scoped indexes to
match repo conventions):

- **`StockBatch`** — `itemId`, `warehouseId`, `batchNumber`, `expiryDate`, `qtyOnHand`,
  `receivedAt`. Unique `(organizationId, itemId, warehouseId, batchNumber, expiryDate)`. Physical
  batch layer, **separate from `InventoryLot`** (which stays a pure cost layer). FEFO reads this.
- **`PosRegister`** (light) — `code`, `name`, `warehouseId`, `isActive`. A till/terminal.
- **`PosShift`** — `registerId`, `cashierId`, `openedAt`, `closedAt?`, `openingFloat`,
  `closingCountedCash?`, `expectedCash?`, `cashVariance?`, `status` (`OPEN`/`CLOSED`).
- **`PosSale`** — 1:1 with `SalesInvoice` (`salesInvoiceId` unique). `shiftId`, `registerId`,
  `clientSaleId` (device-generated UUID, **unique `(organizationId, clientSaleId)`** → idempotent
  offline replay), `syncStatus` (`SYNCED`/`PENDING`/`FAILED`), `soldAt`.
- **`PosTender`** — `posSaleId`, `method` (`PosTenderMethod`), `amount`, `reference?`,
  `changeGiven`. Only `CASH` is created in this slice.

Modified models / enums:

- **`Item`** — add `drugClass DrugClass @default(NON_OBAT)`, `requiresBatchTracking Boolean @default(false)`.
- **`InventoryLedgerEntry`** — add `batchId String?` so batch-tracked movements reference their batch.
- **`ModuleKey`** enum — add `POS_RETAIL` (the gate for POS menu + API access).
- `PaymentMethod` enum is **unchanged** in this slice (no QRIS/e-wallet yet).

New enums: `DrugClass` (`OBAT_BEBAS`, `OBAT_BEBAS_TERBATAS`, `OBAT_KERAS`, `PSIKOTROPIKA`,
`NARKOTIKA`, `NON_OBAT`), `PosShiftStatus`, `PosTenderMethod` (`CASH`, `QRIS`, `EWALLET`,
`EDC_DEBIT`, `EDC_CREDIT` — all defined now, only `CASH` wired, so enabling others later needs no
migration), `PosSaleSyncStatus`.

Migration adds tables/columns only (no destructive change to live accounting data). Existing items
default to `NON_OBAT` / `requiresBatchTracking=false`, so current accounting behavior is unchanged.
A default **walk-in customer** is seeded per pharmacy org (required by `SalesInvoice.customerId`).

## 5. Sale posting flow

`POST /api/v1/pos/sales` with `{ clientSaleId, registerId, shiftId, lines[], tenders[] }` (guarded by
`POS_RETAIL`):

1. **Idempotency:** if a `PosSale` with `(orgId, clientSaleId)` exists, return it (safe replay).
2. **Validate:** shift OPEN; tenders are `CASH` only this slice; cash tendered ≥ total (overpay → change).
3. **In one `$transaction`:**
   a. For each batch-tracked line, run **FEFO picker** → allocate from earliest-expiry `StockBatch`
      rows with `qtyOnHand`; error if insufficient. Non-batch items skip this.
   b. Create `SalesInvoice` (DRAFT), lines (customer = walk-in default unless supplied).
   c. Call **`postInvoiceSend`** → posts revenue/tax/AR + COGS + inventory ledger via existing engine;
      set invoice status SENT.
   d. Decrement allocated `StockBatch.qtyOnHand`; write `batchId` onto the inventory ledger entries.
   e. Create `ARPayment` (method `CASH`) settling the invoice to the cash account, fully allocated.
   f. Create `PosSale` (+`PosTender` cash row), link `shiftId`.
4. Return receipt payload (items, cash tendered, change, batch/expiry, invoice number, timestamp).

GL correctness and COGS come "for free" from the reused engine — the POS never hand-rolls journal
lines. Period guard (`assertPeriodOpen`) still applies.

## 6. Payments (cash only this slice)

- **Cash** — change calculation; drawer reconciliation feeds the shift; works offline.
- The `PosTender` + `lib/pos/tender.ts` abstraction is written so a future slice adds QRIS / e-wallet /
  EDC as new tender methods (and, for dynamic QRIS, a `PaymentGateway` adapter) **without touching the
  sale-posting flow or the schema** — the enum values already exist.
- Rationale for deferral: QRIS/e-wallet require merchant onboarding with a bank/aggregator (a business
  task) and, for auto-verification, an aggregator API integration. Neither is needed to start selling.

## 7. Offline behavior

- Catalog (items, prices, barcodes, batch availability snapshot) cached in **IndexedDB (Dexie)**.
- Offline cash sales are written to an **outbound queue** with their `clientSaleId` and completed
  locally (receipt prints from local data).
- A **sync worker** replays queued sales to `POST /api/v1/pos/sales` when connectivity returns;
  idempotency on `clientSaleId` makes replays safe. Server is the source of truth for stock; the
  offline availability snapshot is advisory, and the server rejects a sale that would oversell a
  batch (surfaced to the cashier on sync as a flagged exception).
- Shift open/close is online-preferred; if offline at close, the Z-report computes from local sale
  data and reconciles on sync.

## 8. Auth & RBAC

Reuse JWT cookie (`msm_token`) + `Role`/`RolePermission`. Add `POS_RETAIL` to `ModuleKey` and seed
**Cashier** and **Pharmacist (APJ)** roles for the pharmacy org. The POS PWA authenticates against the
existing auth endpoints; cashiers are scoped to POS only (cannot reach back-office modules). All POS
API routes assert the caller's org has `POS_RETAIL` and the user holds a POS role.

## 9. Multi-company isolation (why other orgs are unaffected)

- **Data:** every POS table is `organizationId`-scoped; non-pharmacy orgs have zero rows and never
  query them. `Item.drugClass` defaults to `NON_OBAT` for all orgs — no behavior change for e-commerce.
- **UI/menu:** the POS module is hidden unless the org has `POS_RETAIL` enabled — the same module-gating
  MSM already uses per org.
- **Bundle:** the POS is a separate PWA entry/bundle; back-office users of other orgs download no POS
  code, so their app is not enlarged or slowed.
- **Migration:** additive-only (new tables + defaulted columns); existing accounting data and behavior
  for all orgs are untouched, asserted by integration tests.

## 10. Testing (reuse existing harness)

- **Unit (vitest):** FEFO picker (expiry ordering, partial allocation, insufficient stock),
  tender/change (cash), offline-queue reducer, shift expected-cash/variance.
- **Integration (`vitest --config vitest.integration.config.ts`, real test DB):** posting a POS sale
  produces the correct `JournalEntry` (revenue/tax/AR/COGS), `InventoryLedgerEntry`, `StockBatch`
  decrement, and `ARPayment` (cash) allocation; idempotent replay of the same `clientSaleId` creates no
  duplicate; period-guard rejection; a non-pharmacy org sees no POS data/routes.
- **E2E (Playwright):** full cash checkout (scan → cash → change → receipt), shift open→sale→close
  Z-report, and an offline→reconnect→sync cycle.

## 11. Acceptance criteria

1. A cashier opens a shift with an opening float, rings up an OTC item by barcode, pays cash, gets
   correct change, and prints a receipt.
2. That sale appears in MSM as a posted `SalesInvoice` with correct GL (revenue, PPN 11% tax, COGS)
   and inventory decremented from the earliest-expiry batch (FEFO verified).
3. The cash payment fully settles the invoice to the cash account (AR nets to zero).
4. Selling a batch-tracked item with no available non-expired batch is blocked with a clear message.
5. With the network disabled, a cash sale completes and prints; on reconnect it syncs exactly once and
   posts correctly; a replayed `clientSaleId` never double-posts.
6. Closing the shift shows expected vs. counted cash and a Z-report; variance is recorded.
7. Existing MSM accounting behavior and tests are unaffected (items default to `NON_OBAT`,
   non-batch-tracked); the new migration is additive only.
8. A user in a non-pharmacy org (e.g. Cultusia) sees no POS module and cannot reach POS API routes.
9. POS UI defaults to Bahasa Indonesia.

## 12. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Modifying a live v1.0.0 schema | Additive migration only; defaults preserve current behavior; integration tests assert accounting unchanged |
| POS bloating other orgs' app | Module-gated + separate PWA bundle + org-scoped data (§9); other orgs load and see nothing |
| Batch qty vs. cost layers drift | `StockBatch` = physical qty by expiry; `InventoryLot` = value. Both decrement in the same transaction; reconciliation test asserts totals agree |
| Offline oversell | Server is source of truth; batch check on sync rejects+flags; offline limited to cash |
| Deferring non-cash payments blocks go-live | Cash-first is a deliberate MVP; tender model + enum already extensible so QRIS/e-wallet add later with no rework |
| Scope creep into dispensing | Hard out-of-scope list (§2); `drugClass` field only, no enforcement this slice |
```
