# TikTok Settlement Format + Rename Shopee (settlement import, part 2)

**Date:** 2026-07-01
**Status:** Design — pending user review
**Branch:** `claude/tiktok-settlement-import` (extends the open PR #93). Builds on the settlement-import feature already there.

## Problem / context

The settlement-import feature merged into PR #93 was **mislabeled**. The file it parses (`Income.released.id….xlsx`, sheets `Summary`/`Income`/`Adjustment`/`Seller Fee`, English headers on row 5) is the **Shopee** income statement (it lives in `ALL SHOPEE/SHOPEE PAYMENT/`; its Summary labels say "Rebate Provided by Shopee", "AMS Commission"). The parser/detection/mapping are named `tiktokSettlement` / `isTikTokSettlement` / `TIKTOK_COLUMN_TO_KEY` — all wrong.

The **real TikTok** settlement file (`income_*.xlsx`, in `ALL TIKTOK/TIKTOK PAYMENT/`) is a completely different layout: sheet **`Detail pesanan`**, **Indonesian** headers on **row 0**, ~80 columns, and rows mix orders with adjustments (`Jenis transaksi` distinguishes: 8,033 `Pesanan` + a few `Penggantian Biaya Logistik` / `Pembayaran GMV untuk Iklan TikTok`).

The reconciliation **service, endpoint, hook, and wizard are platform-agnostic** (they consume per-order `{ orderId, netReleased, charges }` rows), so only the parser + format detection + naming change per platform.

## Goal

1. **Rename** the existing settlement parser/detection/mapping from `TikTok` → `Shopee` so the built code is correctly labeled (it already handles the Shopee `Income.released` format).
2. **Add a real TikTok income parser** for the `income_*.xlsx` format, feeding the same reconciliation service.
3. **Route** in the wizard: detect which platform's settlement format was uploaded, validate it matches the selected store's platform, and parse accordingly.

## Decisions (from brainstorming)

- **Rename Shopee** (mechanical): correct the mislabel on this branch.
- **TikTok parser:** read `Detail pesanan` (header row 0); reconcile only `Jenis transaksi == 'Pesanan'` rows; per order → `orderId` = `ID Pesanan/Penyesuaian`, `netReleased` = `Jumlah penyelesaian pembayaran`, `charges` = the main fee columns mapped to canonical keys.
- **Non-order rows** (`Pembayaran GMV untuk Iklan TikTok` ad charge, `Penggantian Biaya Logistik`) → **skip + report**: the parser returns them separately so the wizard lists them (type + amount) for the operator to book manually. (Consistent with the deferred Shopee `Adjustment` sheet.)
- **Fee mapping = main columns + plug:** map the significant TikTok fee columns to the canonical `SettlementFeeKey`s; the dozens of minor fee columns are NOT each mapped — the service's **adjustment plug** absorbs the remainder into the connection's `adjustmentAccountId`. Same philosophy as Shopee. Charges are stored as **positive magnitudes** (TikTok stores them negative, like Shopee); the service decides Dr/Cr via `INCOME_KEYS`.

## Part A — Rename (correct the mislabel)

- `src/utils/tiktokSettlement.ts` → `src/utils/shopeeSettlement.ts`; `parseTikTokSettlement` → `parseShopeeSettlement`; `SettlementParseResult`/`SettlementOrder` type names may stay (generic) or gain no platform prefix.
- `src/utils/marketplaceFormat.ts`: `isTikTokSettlement` → `isShopeeSettlement`.
- `src/utils/settlementMapping.ts`: `TIKTOK_COLUMN_TO_KEY` → `SHOPEE_COLUMN_TO_KEY`.
- Update consumers: `SettlementImportModal.tsx` (currently imports/calls the parser), and the parser's unit test file (`tiktokSettlement.test.ts` → `shopeeSettlement.test.ts`).
- Add `nonOrderRows: []` to the renamed Shopee parser's return value (it doesn't parse the Adjustment sheet), so both parsers share the same `SettlementParseResult` shape.
- `lib/settlement-import.ts`, the endpoint, `useImportSettlement`, and the input schema are platform-agnostic → **no change**.

## Part B — TikTok income parser

**`src/utils/tiktokSettlement.ts`** (the real one) — `parseTikTokSettlement(file): Promise<SettlementParseResult>` (same return shape as the Shopee parser, plus a `nonOrderRows` field):
```ts
export interface SettlementParseResult {
  orders: Array<{ orderId: string; netReleased: number; charges: Partial<Record<SettlementFeeKey, number>> }>;
  totalNetReleased: number;
  nonOrderRows: Array<{ orderId: string; type: string; amount: number }>; // reported, not reconciled
}
```
- **Detection:** `isTikTokSettlement(sheetNames)` = sheets include `Detail pesanan` (and `Laporan`). (Rename the OLD `isTikTokSettlement`→`isShopeeSettlement` first, then this new one legitimately takes the TikTok name.)
- Read `Detail pesanan`; header row = index 0. Resolve columns by normalized header name.
- For each data row: read `Jenis transaksi` (col `Jenis transaksi`).
  - `== 'Pesanan'` → an order: `orderId` from `ID Pesanan/Penyesuaian`, `netReleased` from `Jumlah penyelesaian pembayaran`, and each mapped fee column → `charges[key] += Math.abs(value)`.
  - else → push `{ orderId, type, amount: Jumlah penyelesaian pembayaran }` to `nonOrderRows`.

**`TIKTOK_COLUMN_TO_KEY`** in `settlementMapping.ts` (normalized Indonesian header → canonical key; map the significant ones, plug catches the rest):

| TikTok column | canonical key |
|---|---|
| `Biaya komisi platform` | `commissionFee` |
| `Biaya komisi sebelum diskon` | `commissionFee` |
| `Komisi Afiliasi`, `Komisi mitra afiliasi` | `serviceFee` |
| `Biaya Pembayaran` | `transactionFee` |
| `Biaya pemrosesan pesanan` | `orderProcessingFee` |
| `Diskon penjual` | `sellerPromotion` |
| `Biaya layanan logistik` / `Ongkir` | `actualShipping` |
| `PPh Pasal 22 dipungut` | `customTax` |

(Everything else → adjustment plug.)

## Wizard routing

`SettlementImportModal.tsx` gets the selected store's `platform` (already available via the connection). On upload:
- Read the workbook sheet names. If `isShopeeSettlement(sheets)` → `parseShopeeSettlement`; if `isTikTokSettlement(sheets)` → `parseTikTokSettlement`; else error.
- Validate the detected format matches the store's platform (block a TikTok file on a Shopee store, and vice-versa) with a clear message.
- Both parsers return the same `{ orders, totalNetReleased, nonOrderRows }` → the Confirm/mutation path is unchanged (still sends `orders`). The **preview + done** steps additionally list `nonOrderRows` (type + amount) so the operator sees what wasn't reconciled.

## Testing

- **Unit** (`src/utils/__tests__/shopeeSettlement.test.ts` — renamed; `tiktokSettlement.test.ts` — new): the renamed Shopee test still passes; the new TikTok test builds a synthetic `Detail pesanan` workbook (header row 0, an order row + a `Pembayaran GMV` non-order row) and asserts the order is extracted with mapped charges + net, and the non-order row lands in `nonOrderRows`. Format detection: `isShopeeSettlement` vs `isTikTokSettlement` each match their own sheets and reject the other.
- **No new integration test needed** — the reconciliation service is unchanged and already covered; the parsers are pure and unit-tested. Existing settlement int tests stay green.
- Full unit + int suites green; tsc 0.

## Not in this build

- The TikTok non-order rows (ads/logistics) auto-posting; the Shopee `Adjustment`/`Seller Fee` per-order detail; a dedicated ad-spend account slot; a settlement-history screen. Tokopedia/Lazada settlement formats.

## PR

Extends **PR #93** (same branch). Update the PR title/body to "Shopee + TikTok settlement import" at the end.
