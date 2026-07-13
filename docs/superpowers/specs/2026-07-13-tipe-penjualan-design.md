# Tipe Penjualan (Sales Type) — Design Spec

**Date:** 2026-07-13
**Status:** Approved (design)
**Module:** POS Front-of-House (Kasir) — Accurate POS parity, ROADMAP §A3 (high priority)
**Ref:** https://help.accurate.id/product/accurate-pos/pengaturan-utama/kasir/tipe-penjualan/melakukan-transaksi-dengan-tipe-penjualan/

## Summary

Add a configurable **Sales Type** that tags every sale with a channel (offline store vs
online/e-commerce, per platform), auto-assigned from the sale's source, optionally adding a
service charge at the POS, and used for online-vs-offline revenue reporting.

Scope (user-approved, "full version"):
- A **managed list** of sales types (name, channel, service-charge %, tax on/off).
- **Auto-tagging** via defaults on each POS register and each marketplace connection; overridable.
- **Service charge** at POS checkout (a % added to the bill, booked as income via the existing charge mechanism).
- A **"Sales by Type" report** splitting revenue by type/channel.

## Business rules (as agreed)

- A **Sales Type** = { name, channel (ONLINE|OFFLINE), serviceChargePct (0 = none), taxable (on/off), active }.
- **Every** sale carries a sales type: POS sales, marketplace-imported sales, and manual invoices.
- **Auto-assignment:** each POS register has a default sales type; each marketplace connection has a
  default sales type. Applied automatically; the cashier (POS) / editor (manual invoice) can override.
- **Service charge:** if the chosen type has `serviceChargePct > 0`, the POS adds that percent of the
  goods total as a separate "Service Charge" line, booked to the type's income account. Types with 0%
  (e.g. in-store) change nothing. Online marketplace *fees* remain handled by the existing
  `EcommerceConnection` import config — this charge is the POS-side add-on only (no double count).
- **Reporting:** revenue grouped by sales type over a date range, with an "Untagged" bucket for nulls.

## Data model

### New model

**SalesType** (org-scoped)
- `id`, `organizationId`
- `name` (unique per org)
- `channel`: enum `SalesChannel { OFFLINE | ONLINE }`
- `serviceChargePct`: Decimal(5,2), default 0
- `chargeAccountId`: String? — income account the service charge posts to (nullable; POS falls back to a resolved default income account and, failing that, folds the charge into sales revenue exactly as `invoice-send-posting` already handles a charge with no/invalid account)
- `taxable`: Boolean, default true — whether sales of this type include PPN
- `sortOrder`: Int, default 0
- `isActive`: Boolean, default true
- timestamps
- relations: `organization`, and back-relations from SalesInvoice / PosRegister / EcommerceConnection (all `onDelete: SetNull` so deleting a type never deletes sales)

`@@unique([organizationId, name])`, `@@index([organizationId])`.

### Changes to existing models

- **SalesInvoice**: add `salesTypeId String?` (FK → SalesType, `onDelete: SetNull`) + index. Tags the sale.
- **PosRegister**: add `defaultSalesTypeId String?` (FK, SetNull). The register's default at checkout.
- **EcommerceConnection**: add `salesTypeId String?` (FK, SetNull). The default for that connection's imported invoices.

Migration: generated via `prisma migrate diff --from-schema-datamodel <main schema> --to-schema-datamodel`
(main uses Prisma Migrate — see the modifiers migration precedent), verified by `npm run test:int:setup`.

## POS checkout (`lib/pos/sale-posting.ts`)

`PosSaleInput` gains optional `salesTypeId`. In `postPosSale`:
1. Resolve the sales type: `input.salesTypeId ?? register.defaultSalesTypeId ?? null`; load it (org-scoped).
2. Tax: set the invoice's `taxEnabled` from `salesType.taxable` (default true when no type). Everything
   else in the tax-inclusive path is unchanged.
3. Service charge (only when `serviceChargePct > 0`):
   - `goodsTotal` = `computeSaleTotals(materialized, rate).totalAmount` (tax-inclusive, incl. modifiers).
   - `chargeAmt = round2(goodsTotal * pct/100)`.
   - `newTotal = goodsTotal + chargeAmt`; if taxable, the charge's embedded tax `= chargeAmt - chargeAmt/(1+rate)`
     is added to `taxAmount`; if not taxable, `taxAmount` unchanged and the charge row's `taxRate = 0`.
   - Create a `SalesInvoiceCharge { lineNo, label: "Service Charge (" + name + ")", accountId: resolved
     charge account, amount: chargeAmt, taxRate: taxable ? rate : 0 }` on the invoice.
   - Cash-tender validation uses `newTotal`.
   `postInvoiceSend` already credits each charge's account and splits it out of sales revenue, so the GL
   balances with **no new posting code** (verified in `lib/invoice-send-posting.ts`).
4. Set `invoice.salesTypeId`.

Idempotency, FEFO, COGS, ARPayment settlement paths are otherwise unchanged.

## POS UI (`src/pos/`)

- The POS bootstrap/catalog payload includes the org's active sales types + the register's default,
  cached offline (rides on existing catalog/register caching).
- Checkout shows a **sales-type selector** defaulting to the register default; the cashier can switch it.
  The displayed total reflects the selected type's service charge. The chosen `salesTypeId` is sent in
  the sale payload (`toSaleLines`/sale POST). Offline: selection uses cached types; charge computed
  client-side for display, server re-computes authoritatively on sync.

## Marketplace import (`lib/marketplace-import.ts`)

At invoice creation (~L177), set `salesTypeId: connection.salesTypeId ?? null` on the created SalesInvoice.

## Manual invoices

Add an optional **sales-type picker** to the invoice form (defaults to null / a chosen org default);
persisted on `SalesInvoice.salesTypeId`. Minimal — a single select field, no charge automation on the
manual path (v1).

## API surface (`src/app/api/v1/`)

- `sales-types` — GET/POST, `[id]` GET/PUT/DELETE. Org-scoped, `withPermission({ module: 'POS_RETAIL', action })`,
  `logAudit` on writes. Mirrors the modifier-groups route conventions.
- Register default + connection default are set on the **existing** register and integration edit
  endpoints (add `defaultSalesTypeId` / `salesTypeId` to their update payloads + Zod), not new routes.
- `reports/sales-by-type` — GET `?from&to`: groups non-void SalesInvoices by `salesTypeId` in range,
  returns per-type `{ id, name, channel, count, gross (totalAmount), netPreTax }` + an "Untagged" bucket.
  `netPreTax` divides tax out (matching the Sales-Performance report's pre-tax convention).

## UI (back office)

- **Sales Type settings screen** (`src/views/pos/SalesTypeSettings.tsx`): CRUD list — name, channel
  (Offline/Online), service charge %, charge account picker, taxable toggle, active. Mirrors
  `ModifierSettings.tsx`. React Query hook `src/hooks/useSalesTypes.ts`.
- **Register form / POS outlet settings**: a "Default sales type" select.
- **Integration (marketplace) form**: a "Default sales type" select.
- **Sales by Type report view** under Reports: date range + a table/summary (online vs offline totals,
  per-type rows). Mirrors the existing Sales-Performance report view.
- Nav gated by `pos_retail` (the dedicated frontend permission key being added in the parallel RBAC
  follow-up); backend enforces `POS_RETAIL`. **Dependency note:** if `pos_retail` isn't merged yet, gate
  on the same interim key the Modifier screen uses and switch once available.

## Starter data

On setup, seed two starter types per org when none exist — "Toko Offline" (OFFLINE, 0%) and
"Online" (ONLINE, 0%) — so the feature is usable immediately. Non-blocking; user edits/adds freely.

## Testing

- **Unit:** service-charge math (pct of goods total; taxable vs non-taxable tax split; 0% adds nothing);
  sales-type resolution (input → register default → null); report grouping incl. Untagged + pre-tax net.
- **Integration:** POS sale with a charging type → invoice carries `salesTypeId`, a `SalesInvoiceCharge`
  row exists on the right account, GL balances, cash tender covers the new total; a 0% type adds no
  charge; marketplace import stamps the connection's type; `sales-by-type` report returns correct splits.

## Out of scope (v1)

- Fixed-amount (non-%) charges; per-line charge; charge on the manual-invoice path.
- Price-category-per-type (Accurate links a price list to a type) — deferred; `taxable` + charge cover the ask.
- Editing historical sales' type in bulk.

## Deviation / dependency notes

- Reuses the existing `SalesInvoiceCharge` + `invoice-send-posting` charge path — no new GL code.
- `taxable` is the only field touching the tax computation (sets invoice `taxEnabled`); everything else is additive.
- Frontend gating depends on the `pos_retail` RBAC key (parallel task); interim-gate + switch if not yet merged.
