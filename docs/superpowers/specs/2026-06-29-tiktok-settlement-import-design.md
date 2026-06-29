# TikTok Settlement-Statement Import (②.4, per-order reconciliation)

**Date:** 2026-06-29
**Status:** Design — pending user review
**Part of roadmap:** ① integration setup (done) → ② order-export import (MERGED, PR #89) → **②.4 settlement import (this spec)** → ③ best-selling widget (PR #90).

## Problem

Sub-project ② imports the marketplace **order export** and books, per order: the sales invoice (`Dr AR / Cr Revenue`) and a settlement receipt (`Dr Settlement-holding / Cr AR`). So the **Settlement-holding** (clearing) account accumulates a debit equal to the gross of every imported order, and the platform **fees and the net payout are not yet recorded**. The platform's actual fee breakdown + net payout lives in its **settlement statement** (`Income.released…xlsx`), not the order export.

## Goal

Import a TikTok settlement statement and, **per settled order**, book the fees + net payout and **clear the Settlement-holding account** down to zero, reconciling each settled order by `Order ID` → the invoice ② created (`poNumber`). Orders the statement settles that aren't in the DB are **skipped and reported**, not posted.

Out of scope: Shopee settlement format (TikTok first; parser structured to add it later), per-SKU fee allocation, aggregate-only posting.

## Decisions (from brainstorming)

- **Per-order reconciliation** (not aggregate): match each settled order to its invoice/receipt and post per order.
- **Unmatched settled order → skip + report** (don't post; list it so the operator imports its order export and re-runs).
- **TikTok first.** Format-detected so an order export or a Shopee file is rejected.
- **GL flow:** clear Settlement-holding at **X** = the amount ② booked for that order (looked up from the receipt), and send the timing difference (`X − settlement revenue`) to the connection's **adjustment** account. This keeps holding zeroing out per order.
- **Idempotency:** minimal — add `settledAt` + `settlementJournalId` to the `ARPayment` receipt; settle once, skip if already set. (Schema change → `prisma db push` at deploy.)
- **Entry point:** a per-shop **"Import Settlement"** action on the E-commerce Integrations tab.

## GL model (per matched order)

Let **X** = ②'s receipt amount for the order (its debit sitting in Settlement-holding), **N** = the order's *net released* from the statement, and the statement's money columns (commission, service fee, shipping, vouchers, refund, …) as signed amounts whose net = the platform's expenses **E** (so `N = R − E`, where `R` = settlement revenue).

Per order, one balanced journal:
- **Cr** Settlement-holding **X** — clears exactly what ② parked there.
- **Dr** Bank (the connection's payout/holding bank account or a dedicated payout account) **N**.
- For each non-zero settlement money column → its **mapped GL account**, natural sign (a charge = debit expense; a rebate/income = credit).
- **Dr/Cr** Adjustment (`fees.adjustmentAccountId`) = the balancing plug = `X − R` (refunds/promotions the statement accounts in a different period than ② booked).

Balanced: `Credits (X + rebates) = Debits (N + charges + plug)` — algebraically `X` on both sides because `N + E = R` and `plug = X − R`.

Worked check (15–21 Jun example, statement totals): Revenue 19,764,680 − Expenses 3,790,898 = Released 15,973,782. Posting Dr Bank 15,973,782 + Dr fees 3,790,898 = 19,764,680 = Cr holding (had ②'s gross for those orders, ± adjustment plug).

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
| Net released | Bank/payout account | Dr |
| Holding clear | `connection.holdingAccount` (its GL asset, via `resolveBankLinkedAssetAccountId` — same as ②) | Cr |
| Residual / unmapped / timing | `fees.adjustmentAccountId` | plug |

**For the user to confirm during review:** the Service-Fee → `affiliateFee` mapping (vs `platformFee`), and whether shipping should net into one `shippingVariance` account instead of the three shipping accounts. Defaults above; easy to change.

## Architecture / components

Mirrors ②. Reuse `postJournalEntry` (`@/lib/gl` / wherever ② posts), `resolveBankLinkedAssetAccountId`, the integration hooks, and the import-wizard shell.

1. **Parser** — `src/utils/tiktokSettlement.ts`: `parseTikTokSettlement(file): Promise<SettlementParseResult>`.
   - Reads the **Income** sheet (real header row at index 5; per-order rows keyed by `Order ID`) into `{ orderId, payoutDate, columns: Record<string, number>, netReleased }[]`.
   - Reads the **Summary** sheet totals as a **checksum** (sum of per-order ≈ summary; warn on mismatch beyond a rupiah tolerance).
   - Reads the **Adjustment** sheet (period adjustments not tied to an order) → posted in aggregate to `adjustmentAccountId`.
   - **Format detection:** confirm it's a TikTok settlement export (sheets `Summary`/`Income`/`Adjustment`/`Seller Fee`, the Income header signature). Reject order exports / Shopee files with a clear message.

2. **Reconciliation service** — `lib/settlement-import.ts`: `importSettlement(orgId, userId, connectionId, parsed): Promise<SettlementResult>`.
   - Load the connection + its `ShopMappings`. Resolve the holding GL account once (as ② does) and the payout bank account.
   - Per order, in its own `prisma.$transaction`: find the `SalesInvoice` by `poNumber` + its settlement `ARPayment`. If none → push to `skipped` with amounts. If the receipt already has `settledAt` → push to `alreadySettled` (idempotent skip). Else post the per-order journal (above), set `ARPayment.settledAt` + `settlementJournalId`.
   - Post the period-adjustment journal (Adjustment sheet) once.
   - Return `{ posted, skipped: [{orderId, net}], alreadySettled, totals }`.

3. **Schema** — add to `ARPayment`: `settledAt DateTime?`, `settlementJournalId String?` (FK to JournalEntry, `onDelete: SetNull`). Migration via `prisma db push` at deploy.

4. **Endpoint** — `POST /api/v1/integrations/[id]/settlement-import`, `withPermission({ module: 'BANKING', action: 'create' })` (it books a bank receipt + clears a clearing account; confirm the right module during planning — could be a dedicated settlement permission). Validates a `settlementImportInputSchema` and calls the service.

5. **Hook + wizard** — `useImportSettlement()` in `useIntegrations.ts`; a settlement-import wizard (select shop → upload → format-detect → preview: matched count, unmatched list, fee totals, checksum status → Confirm → done: posted/skipped/already-settled). Entry: an "Import Settlement" button per shop on `src/views/integrations/Integrations.tsx`.

## Testing

- **Parser unit** (`src/utils/__tests__/tiktokSettlement.test.ts`): Income header at row 5, per-order extraction, Summary checksum, format detection rejects an order export.
- **Integration** (`lib/__tests__/integration/settlement-import.int.test.ts`, real Postgres, reuse the ② harness to seed an imported order + its holding receipt):
  - Matched order → holding credited by X, bank debited by net, fees booked, **trial balance balanced**, receipt marked `settledAt`.
  - Unmatched settled order → in `skipped`, nothing posted.
  - **Idempotent** re-import → `alreadySettled`, no double-post, GL unchanged.
  - Period adjustment row → posted to the adjustment account.
- Full int + unit suites stay green; tsc 0.

## Open questions for review

1. The Service-Fee and shipping mappings noted above.
2. Payout bank account: use the connection's `holdingAccount`-linked bank, or a separate "TikTok payout" bank account? (Default: a distinct payout bank account chosen at import; falls back to org default bank.)
3. Permission module for the endpoint (`BANKING` vs a dedicated one).

## Not in this build

- Shopee settlement format (next).
- Per-SKU fee allocation (Seller Fee sheet detail) — aggregate per order is enough for the books.
- A settlement-history / audit screen (the minimal `settledAt` fields suffice for idempotency now).
