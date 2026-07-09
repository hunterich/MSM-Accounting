# POS Sales Targets by Staff Member — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending spec review
**Module:** Pharmacy POS engine (`POS_RETAIL` orgs); foundation shared with a future Salon profile

## Background

The POS already records every sale and (via `PosSale.cashierId`) who operated the till. It also
already supports **service items** — `ItemType.SERVICE` exists and the checkout engine skips
stock/batch handling for non-stock lines (`sale-posting.ts`: `if (!item?.requiresBatchTracking) continue;`).
So the same engine can serve a salon (services) as well as a pharmacy (batch-tracked products).

This spec adds the management layer: **monthly sales targets per person** and a **Sales Performance
scoreboard**. Crucially, to serve both business types without rework, sales are credited at the
**line level to a staff member (Employee)**, not to the till login:

- **Pharmacy:** one cashier rings up the whole sale; every line auto-credits that cashier's own
  staff record. No change to the cashier's screen.
- **Salon (later):** different stylists perform different lines on one ticket; the cashier picks the
  stylist per line. Commission per stylist later flows into payroll (Employee already links to `PayrollLine`).

## Goals

- Set a **monthly sales target** (rupiah) per staff member.
- Show a **Sales Performance** report: per-person target vs. actual for a chosen month, with
  remaining, % of target, an on-track indicator, and a team total.
- **Manager-only** via a new permission; **org-gated** so only relevant orgs see it.
- Attribution is **line-level → Employee**, so the salon reuses this foundation unchanged.

## Non-Goals (deferred)

- The **salon front-end**: services on the till screen, a business-type "profile" toggle, hiding the
  pharmacy-only UI (drug class / expiry / stock), and the per-line stylist picker. Separate follow-up
  project; this spec only lays the data + attribution foundation it will build on.
- Automatic commission/bonus calculation (the Employee link makes it possible later).
- Daily/sub-monthly targets; subtracting refunds (no returns feature yet); a staff-facing leaderboard.

## Attribution & the "sold so far" number

Each sale line is credited to one **staff member (Employee)**. A person's actual for a month = the
sum of the **line values they are credited with** (the line subtotal — quantity × price − line
discount, **before tax**), across POS sales whose `soldAt` falls in that month.

- Line values come from `SalesInvoiceLine.lineSubtotal` (the POS sale's invoice lines). Pre-tax is the
  standard base for sales targets and future commission; PPN is not the salesperson's sale.
- Only real posted POS sales count. Offline sales enter once synced, dated by `soldAt`.
- **Month boundaries use Asia/Jakarta (WIB, UTC+7)**, not UTC — a sale at 00:30 WIB on the 1st counts
  in the new month. The boundary logic gets an explicit unit test.
- **Default crediting (pharmacy):** if a line has no explicit performer, the server credits the
  **cashier's linked staff record** (see the Employee↔User link below).
- **Unassigned bucket:** lines whose cashier has no linked staff record (and no explicit performer)
  are credited to an "Unassigned" row so team totals always reconcile and the gap nudges setup.

## Data model changes (Prisma; additive, applied via `prisma db push`)

1. **`Employee.userId String? @unique`** — optional link from a staff record to a login account.
   Lets a logged-in cashier resolve to their staff record. Nullable: staff can exist without a login
   (salon stylists), and users without a staff record simply don't get credited (they land in
   "Unassigned"). Additive; no effect on existing HR/payroll behaviour.

2. **`SalesInvoiceLine.performedById String?`** — optional FK to `Employee`; who is credited for that
   line. Null on all existing and non-POS invoices (unchanged behaviour). "Sales rep per line" is a
   standard, harmless additive field; posting logic ignores it.

3. **New model `PosSalesTarget`:**

   | Field | Type | Notes |
   |---|---|---|
   | `id` | String cuid | PK |
   | `organizationId` | String | org scope; FK Organization (cascade) |
   | `employeeId` | String | FK Employee — who the target is for |
   | `month` | String | `"YYYY-MM"` (WIB calendar month) |
   | `targetAmount` | Decimal(18,2) | rupiah |
   | `createdAt`/`updatedAt` | DateTime | |

   - `@@unique([organizationId, employeeId, month])`, `@@index([organizationId, month])`.

4. **New `ModuleKey` value `POS_REPORTS`** — manager-level permission gating the report and target
   editing. Distinct from `POS_RETAIL` so a till cashier does not automatically see everyone's numbers.

`PosSale.cashierId` stays as-is (who operated the till — used by shift/Z-report). The new
`performedById` is the separate *credit* dimension.

## Checkout change (minimal, engine only)

- The POS sale input gains an optional `performedById` per line.
- On posting each `SalesInvoiceLine`, set `performedById` = the line's provided value, else the
  cashier's linked `Employee.id` (resolved from `User.id → Employee.userId`), else null (Unassigned).
- The **pharmacy till UI is unchanged** — it sends no performer and gets the auto-credit. The salon
  follow-up will add the per-line picker that populates this field.

## Report & targets

**Rows** are keyed by staff member. For the selected month, the row set is the union of: employees
with a target that month, and employees credited with ≥1 line that month — plus the "Unassigned"
bucket when present. Names from `Employee.name`.

**On-track indicator** reflects pace, so it's meaningful mid-month:
- `expected = targetAmount × (WIB days elapsed / days in month)`
- 🟢 `sold ≥ targetAmount` (hit) or `sold ≥ expected`; 🟡 `sold ≥ 0.9 × expected`; 🔴 below; no colour if no target.

## API endpoints (`/api/v1/pos/`, guarded `withPermission({ module: 'POS_REPORTS', action })`, org-scoped)

1. `GET /reports/sales-performance?month=YYYY-MM` (view) →
   `{ month, rows: [{ employeeId|null, name, target, sold, remaining, pct, status }], totals }`.
2. `GET /targets?month=YYYY-MM` (view) → active staff for the org + their target for the month (so the
   manager can set a target for anyone, including staff with no sales yet).
3. `PUT /targets` (edit) → `{ month, targets: [{ employeeId, targetAmount }] }`; bulk upsert (blank
   clears). "Copy last month" is client-side: fetch prior month, pre-fill, save.

## Frontend (back-office Vite app)

- **`src/views/reports/SalesPerformance.tsx`** (follows existing `src/views/reports/*`): month picker
  (defaults to current WIB month), scoreboard table (Staff · Target · Sold · Remaining · % · status +
  progress bar + team total), and an "Edit targets" editor (staff list + amounts + "copy last month" +
  Save → `PUT /targets`).
- **Route** in `src/App.tsx` under the reports group, guarded by the front-end `pos_reports` key.
- **Sidebar** (`src/components/Layout/Sidebar.tsx`): "Sales Performance" under **Reports**, shown when
  `hasPermission('pos_reports','view')`.
- **Access store** (`src/stores/useAccessStore.ts`): register `pos_reports` + path mapping for the role
  editor and nav gating.

## Permissions & org isolation

- `POS_REPORTS` is granted per-role, per-org. Cashier roles don't get it by default → no scoreboard.
  Manager/owner role gets `view` + `edit`. ADMIN bypasses.
- All data is `organizationId`-scoped; other orgs (Cultusia, etc.) have no grant and no data → no new
  menu, page, or numbers, exactly like `POS_RETAIL` today.

## Testing

- **Unit:** WIB month-range incl. cross-midnight; per-employee line aggregation (sums, remaining, pct,
  status thresholds, no-target case); cashier→employee default resolution incl. the unlinked→Unassigned
  fallback; target upsert/clear.
- **Integration:** report end-to-end for an org with 2+ staff, mixed sales/targets → correct
  rows/totals incl. Unassigned; `POS_REPORTS` gate returns 403 for an ungranted role, ADMIN passes;
  cross-org isolation (org A never sees org B's sales/targets); a POS sale defaults line credit to the
  cashier's employee.

## Rollout

- Additive schema (`prisma db push`): 3 new columns/relations + 1 table + 1 enum value; no drops.
- Enable for a shop: link its cashier logins to staff records, then grant the manager/owner role
  `POS_REPORTS`. No effect on other orgs.
- Branch `pos-sales-targets` off `main`, TDD, reviewed before merge — same process as prior POS slices.
- **Salon follow-up (separate spec):** business-type profile, services on the till, hiding pharmacy-only
  UI, per-line stylist picker (populates `performedById`), and commission-to-payroll — all built on this
  foundation.
