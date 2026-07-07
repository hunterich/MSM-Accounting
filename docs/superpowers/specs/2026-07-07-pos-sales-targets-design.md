# POS Sales Targets by Salesperson — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending spec review
**Module:** Pharmacy POS (`POS_RETAIL` org only)

## Background

The POS already stamps every sale with the cashier who rang it up (`PosSale.cashierId`,
set from the authenticated user in `src/app/api/v1/pos/sales/route.ts`). For this shop the
**cashier is the salesperson**, so the raw attribution data already exists — no change is
needed at the till.

What's missing is the management layer on top: a way to **set a monthly target per person**
and a **scoreboard** that shows each person's sales against their target. This spec covers
that layer.

## Goals

- Let a manager set a **monthly sales target** (rupiah) per salesperson.
- Show a **Sales Performance** report: per-person target vs. actual sales for a chosen month,
  with remaining amount, % of target, and an on-track indicator; plus a team total.
- Keep it **manager-only** via a new permission, and **org-gated** so only the Pharmacy sees it.

## Non-Goals (deferred, per YAGNI)

- Automatic commission/bonus calculation.
- Daily (or any sub-monthly) target breakdown — targets are monthly.
- Subtracting refunds/returns — the POS has no returns feature yet; when it does, returned
  amounts will be subtracted from the salesperson's total.
- A staff-facing leaderboard — the report is management-only for now.
- Splitting "salesperson" from "cashier" — they are the same person here.

## Attribution & the "sold so far" number

A salesperson's actual sales for a month = the sum of the **total amount** of that cashier's
completed POS sales whose `soldAt` falls within the month.

- Source: `PosSale` joined to its `SalesInvoice` (`totalAmount`, tax-inclusive — the amount the
  customer actually paid). Group by `PosSale.cashierId`.
- Only real posted sales count. Offline sales are not in the database until they sync, so they
  are naturally excluded until synced (then included, dated by `soldAt`).
- **Month boundaries use Asia/Jakarta (WIB, UTC+7)**, not UTC. `soldAt` is stored in UTC; a sale
  at 00:30 WIB on Jul 1 must count as July, not June. The month range is
  `[localMonthStart→UTC, nextLocalMonthStart→UTC)`. This boundary logic gets an explicit unit test.

## Data model changes (Prisma)

**New model `PosSalesTarget`:**

| Field | Type | Notes |
|---|---|---|
| `id` | String cuid | PK |
| `organizationId` | String | org scope; FK to Organization (cascade) |
| `cashierId` | String | the user id, same convention as `PosSale.cashierId` (plain string, not a relation) |
| `month` | String | `"YYYY-MM"` (the target's calendar month, WIB) |
| `targetAmount` | Decimal(18,2) | rupiah |
| `createdAt` / `updatedAt` | DateTime | |

- Unique: `@@unique([organizationId, cashierId, month])`.
- Index: `@@index([organizationId, month])`.
- Applied via `prisma db push` (repo is schema-first, no migrations folder — matches existing POS work).

**New `ModuleKey` enum value: `POS_REPORTS`** — the manager-level permission that gates the
Sales Performance report and target editing. Distinct from `POS_RETAIL` (the till) so a cashier
with till access does not automatically see everyone's numbers.

## Salespeople shown in the report

For the selected month, the row set is the **union** of:
- cashiers who have a target row for that month, and
- cashiers who made at least one sale that month.

Names resolve via `User.fullName` (look up `User` by id = `cashierId`). A person with sales but
no target shows their actual with a blank target and no %. A person with a target but no sales
shows 0 sold.

## On-track indicator

Colour reflects **pace**, so it is meaningful mid-month rather than only at month end:

- `expected = targetAmount × (WIB days elapsed in month / total days in month)`
- 🟢 **green** — `sold ≥ targetAmount` (target already hit), or `sold ≥ expected`
- 🟡 **amber** — `sold ≥ 0.9 × expected` (close to pace)
- 🔴 **red** — below that
- No target set → no colour (informational row only).

## API endpoints (Next.js App Router, under `/api/v1/pos/`)

All guarded with `withPermission({ module: 'POS_REPORTS', action })` and scoped by the
`x-org-id` header (same pattern as existing POS routes). ADMIN bypasses, per `requirePermission`.

1. `GET /reports/sales-performance?month=YYYY-MM` (action: `view`)
   → `{ month, rows: [{ cashierId, name, target, sold, remaining, pct, status }], totals: { target, sold } }`.
   Computes the WIB month range, aggregates sales per cashier, joins targets and names.

2. `GET /targets?month=YYYY-MM` (action: `view`)
   → list of `{ cashierId, name, targetAmount }` for the month (for the edit screen; includes all
   POS-eligible users so the manager can set a target for anyone, even with no sales yet).

3. `PUT /targets` (action: `edit`) — bulk upsert
   → body `{ month, targets: [{ cashierId, targetAmount }] }`; upserts each row (delete/zero when
   amount is blank). One endpoint keeps the "edit all, save once" UX simple.

"Copy last month" is handled client-side: the edit screen can fetch the previous month's targets
and pre-fill the form; the manager reviews and saves via `PUT`. No dedicated copy endpoint.

## Frontend (Vite back-office app, `src/`)

- **New page `src/views/reports/SalesPerformance.tsx`** — follows the existing
  `src/views/reports/*` pattern (e.g. `CashFlow.tsx`). Contains:
  - a **month picker** (defaults to current WIB month),
  - the **scoreboard table** (Salesperson · Target · Sold · Remaining · % · status dot) with a
    progress bar per row and a team total,
  - an **"Edit targets"** action opening an inline editor/modal (list of people + amount inputs +
    "copy last month" + Save → `PUT /targets`).
- **Route** in `src/App.tsx` under the reports group, wrapped with the app's permission guard
  keyed to the new module (front-end key `pos_reports`).
- **Sidebar** (`src/components/Layout/Sidebar.tsx`): add a "Sales Performance" item in the
  **Reports** group, shown only when `hasPermission('pos_reports','view')`.
- **Access store** (`src/stores/useAccessStore.ts`): register the `pos_reports` module key and its
  path mapping so it appears in the role editor and nav gating works.

## Permissions & org isolation

- `POS_REPORTS` is granted per-role, per-org — same mechanism as every other module. Cashiers'
  roles are **not** granted it by default, so they don't see the scoreboard. The manager/owner role
  gets `view` (see report) and `edit` (set targets). ADMIN sees everything.
- All data is `organizationId`-scoped. Other companies (Cultusia, etc.) have no `POS_REPORTS`
  grant and no data, so they see no new menu, page, or numbers — identical to how `POS_RETAIL`
  is walled off today.

## Testing

- **Unit**
  - WIB month-range computation, including the cross-midnight boundary case.
  - Per-cashier aggregation: sums, remaining, pct, and status thresholds (green/amber/red, on-pace
    math, no-target case).
  - Target upsert/clear logic.
- **Integration**
  - Report end-to-end for an org with 2+ cashiers, a mix of sales and targets → correct rows/totals.
  - Permission gate: a role without `POS_REPORTS` gets `403`; ADMIN passes.
  - Cross-org isolation: org A's report never includes org B's sales/targets.

## Rollout

- Schema change applied to dev/test DB via `prisma db push` (additive: one new table + one new
  enum value; no drops).
- To enable for the Pharmacy: grant the manager/owner role `POS_REPORTS` (view + edit). No effect
  on any other org.
- Built on branch `pos-sales-targets` off `main`, TDD, reviewed before merge — same process as the
  prior POS slices.
