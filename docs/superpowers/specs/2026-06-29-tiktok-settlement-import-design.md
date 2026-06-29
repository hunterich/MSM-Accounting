# TikTok Settlement-Statement Import (②.4, per-order reconciliation)

**Date:** 2026-06-29
**Status:** Design — pending user review
**Part of roadmap:** ① integration setup (done) → ② order-export import (MERGED, PR #89) → **②.4 settlement import (this spec)** → ③ best-selling widget (PR #90).

## Problem

Sub-project ② imports the marketplace **order export** and books, per order: the sales invoice (`Dr AR / Cr Revenue`) and a settlement receipt (`Dr Settlement-holding / Cr AR`). So the **Settlement-holding** (clearing) account accumulates a debit equal to the gross of every imported order, and the platform **fees and the net payout are not yet recorded**. The platform's actual fee breakdown + net payout lives in its **settlement statement** (`Income.released…xlsx`), not the order export.

## Goal

Import a TikTok settlement statement and, **per settled order**, book the platform **fees** against the e-commerce wallet (`holdingAccount`), so the wallet drops from the order's gross to its **net released** amount — reconciling each settled order by `Order ID` → the invoice ② created (`poNumber`). The net stays in the wallet to be withdrawn to the real bank later (existing bank-transfer feature). Orders the statement settles that aren't in the DB are **skipped and reported**, not posted.

Out of scope: Shopee settlement format (TikTok first; parser structured to add it later), per-SKU fee allocation, aggregate-only posting.

## Decisions (from brainstorming)

- **Per-order reconciliation** (not aggregate): match each settled order to its invoice/receipt and post per order.
- **Unmatched settled order → skip + report** (don't post; list it so the operator imports its order export and re-runs).
- **TikTok first.** Format-detected so an order export or a Shopee file is rejected.
- **GL flow (wallet model):** the net payout **stays in the e-commerce wallet** (the connection's `holdingAccount` / "Kas/Bank Saldo e-Commerce"). Per order, the settlement books **only the fees** (Dr the fee accounts, Cr the wallet), dropping the wallet from **X** (what ② parked there) to the order's **net released N**; the timing difference (`X − settlement revenue`) plugs to the **adjustment** account. The net N is withdrawn wallet→real bank later as a normal bank transfer (existing feature) — the settlement import does **not** touch a separate bank account.
- **Fee → account mapping is form-driven:** each settlement fee column routes to whatever GL account the operator configured in the connection's `ShopMappings` (the integration form's *Shipping & Fees* / *Others* tabs). No hardcoded account choices in the importer.
- **Idempotency:** minimal — add `settledAt` + `settlementJournalId` to the `ARPayment` receipt; settle once, skip if already set. (Schema change → `prisma db push` at deploy.)
- **Entry point:** a per-shop **"Import Settlement"** action on the E-commerce Integrations tab.

## GL model (per matched order — wallet model)

Let **X** = ②'s receipt amount for the order (its debit sitting in the e-commerce wallet / `holdingAccount`), **N** = the order's *net released* from the statement, and the statement's fee/shipping/voucher columns as signed amounts mapped to the connection's **form-configured** accounts (their net = the platform's expenses **E**; `N = R − E`, `R` = settlement revenue).

The net **stays in the wallet** — the settlement books only the fees, dropping the wallet from X to N. Per order, one balanced journal:
- For each non-zero settlement money column → its **form-configured GL account** (`ShopMappings`), natural sign (a charge = Dr expense; a rebate/income = Cr).
- **Cr** wallet (`holdingAccount` GL asset, resolved via `resolveBankLinkedAssetAccountId` as ② does) = **X − N** — drops the wallet to the withdrawable net.
- **Dr/Cr** Adjustment (`fees.adjustmentAccountId`) = the balancing plug = `(X − N) − E` = `X − R` (refunds/promotions the statement books in a different period than ②).

Balanced: wallet credit `(X − N)` = fee debits `E` + adjustment `(X − N − E)`. The net **N remains in the wallet**; a later wallet→bank transfer (existing banking feature) moves it to the real bank when the platform pays out.

Worked check (15–21 Jun statement): the 3,790,898 of expenses post to the configured fee accounts; the wallet drops by `gross − 15,973,782` for those orders; the **net 15,973,782 stays in the wallet** to be withdrawn.

## Column → account mapping (TikTok → `ShopMappings`)

| Settlement column(s) | Mapped account | Dr/Cr |
|---|---|---|
| Commission fee, AMS Commission Fee, Seller Order Processing Fee | `fees.platformFeeAccountId` | Dr (expense) |
| Service Fee | `fees.affiliateFeeAccountId` | Dr |
| Your Seller product promotion | `fees.sellerDiscountAccountId` | Dr |
| Shipping Fee Paid by Buyer | `shipping.buyerShippingRevenueAccountId` | Cr (income) |
| Actual Shipping Fee | `shipping.actualShippingCostAccountId` | Dr |
| Shipping Rebate From Shopee / 3PL discount | `shipping.platformShippingSubsidyAccountId` | Cr |
| Shipping insurance | `shipping.shippingInsuranceAccountId` | Dr |
| Voucher Sponsored by Seller (+ cofund) | `others.sellerVoucherAccountId` | Dr |
| Rebate Provided by platform | `others.platformVoucherAccountId` | Cr |
| Coin Cashback Sponsored by Seller | `others.coinCashbackAccountId` | Dr |
| Refund Amount | `others.refundAccountId` | Dr |
| Withholding tax (if present) | `others.withholdingTaxAccountId` | Dr |
| Wallet reduction (drop to net) | `connection.holdingAccount` GL asset (via `resolveBankLinkedAssetAccountId` — same as ②) | Cr (X − N) |
| Residual / unmapped / timing | `fees.adjustmentAccountId` | plug = (X − N) − E |

The *column → slot* grouping above is just the importer's **default routing**; the **actual GL account for each slot is whatever the operator configured on the integration form** (`ShopMappings`). To post a fee type elsewhere, the operator changes that slot's account on the form — no code change. A settlement fee type with no slot today is routed to `adjustmentAccountId` (and we can add a slot to the form later if needed).

## Architecture / components

Mirrors ②. Reuse `postJournalEntry` (`@/lib/gl` / wherever ② posts), `resolveBankLinkedAssetAccountId`, the integration hooks, and the import-wizard shell.

1. **Parser** — `src/utils/tiktokSettlement.ts`: `parseTikTokSettlement(file): Promise<SettlementParseResult>`.
   - Reads the **Income** sheet (real header row at index 5; per-order rows keyed by `Order ID`) into `{ orderId, payoutDate, columns: Record<string, number>, netReleased }[]`.
   - Reads the **Summary** sheet totals as a **checksum** (sum of per-order ≈ summary; warn on mismatch beyond a rupiah tolerance).
   - Reads the **Adjustment** sheet (period adjustments not tied to an order) → posted in aggregate to `adjustmentAccountId`.
   - **Format detection:** confirm it's a TikTok settlement export (sheets `Summary`/`Income`/`Adjustment`/`Seller Fee`, the Income header signature). Reject order exports / Shopee files with a clear message.

2. **Reconciliation service** — `lib/settlement-import.ts`: `importSettlement(orgId, userId, connectionId, parsed): Promise<SettlementResult>`.
   - Load the connection + its `ShopMappings`. Resolve the wallet (`holdingAccount`) GL account once (as ② does). No separate bank account — the net stays in the wallet.
   - Per order, in its own `prisma.$transaction`: find the `SalesInvoice` by `poNumber` + its settlement `ARPayment`. If none → push to `skipped` with amounts. If the receipt already has `settledAt` → push to `alreadySettled` (idempotent skip). Else post the per-order journal (above), set `ARPayment.settledAt` + `settlementJournalId`.
   - Post the period-adjustment journal (Adjustment sheet) once.
   - Return `{ posted, skipped: [{orderId, net}], alreadySettled, totals }`.

3. **Schema** — add to `ARPayment`: `settledAt DateTime?`, `settlementJournalId String?` (FK to JournalEntry, `onDelete: SetNull`). Migration via `prisma db push` at deploy.

4. **Endpoint** — `POST /api/v1/integrations/[id]/settlement-import`, gated the same way as the order-export import: `withPermission({ module: 'AR_INVOICES', action: 'create' })`. Validates a `settlementImportInputSchema` and calls the service.

5. **Hook + wizard** — `useImportSettlement()` in `useIntegrations.ts`; a settlement-import wizard (select shop → upload → format-detect → preview: matched count, unmatched list, fee totals, checksum status → Confirm → done: posted/skipped/already-settled). Entry: an "Import Settlement" button per shop on `src/views/integrations/Integrations.tsx`.

## Testing

- **Parser unit** (`src/utils/__tests__/tiktokSettlement.test.ts`): Income header at row 5, per-order extraction, Summary checksum, format detection rejects an order export.
- **Integration** (`lib/__tests__/integration/settlement-import.int.test.ts`, real Postgres, reuse the ② harness to seed an imported order + its holding receipt):
  - Matched order → **wallet credited by `(X − N)`**, fees booked to the configured accounts, the **net stays in the wallet**, **trial balance balanced**, receipt marked `settledAt`.
  - Unmatched settled order → in `skipped`, nothing posted.
  - **Idempotent** re-import → `alreadySettled`, no double-post, GL unchanged.
  - Period adjustment row → posted to the adjustment account.
- Full int + unit suites stay green; tsc 0.

## Resolved (from review)

- **Fee → account mapping:** form-driven via `ShopMappings` (operator configures each slot's account on the integration form); no hardcoded account choices.
- **Payout model:** wallet model — net stays in the `holdingAccount` wallet; settlement books only fees; withdrawal wallet→bank is a separate existing step. No new payout-bank field.
- **Endpoint permission:** `AR_INVOICES:create`, same as the order-export import.

## Not in this build

- Shopee settlement format (next).
- Per-SKU fee allocation (Seller Fee sheet detail) — aggregate per order is enough for the books.
- A settlement-history / audit screen (the minimal `settledAt` fields suffice for idempotency now).
