# TikTok Settlement Format + Rename Shopee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the mislabeled settlement parser (it parses Shopee, not TikTok) by renaming `tiktok…`→`shopee…`, then add a real TikTok `income_*.xlsx` parser, and route by detected format in the wizard — both feeding the existing platform-agnostic reconciliation service.

**Architecture:** Extends the settlement-import feature already on this branch. The reconciliation service (`lib/settlement-import.ts`), endpoint, hook, and input schema are platform-agnostic (consume `{ orderId, netReleased, charges }` rows) and are NOT touched. Only the per-platform parser + format detection + the shared fee-key mapping change.

**Tech Stack:** TypeScript, `xlsx` (SheetJS), Vitest unit tests, React (the wizard). Branch `claude/tiktok-settlement-import` (extends open PR #93).

**Reference spec:** `docs/superpowers/specs/2026-07-01-tiktok-settlement-format-design.md`

## Existing code (from the ②.4 build on this branch)
- `src/utils/settlementMapping.ts` — exports `SettlementFeeKey`, `TIKTOK_COLUMN_TO_KEY` (currently the SHOPEE columns), `KEY_TO_SLOT`.
- `src/utils/tiktokSettlement.ts` — `parseTikTokSettlement(file)` (currently parses the SHOPEE `Income.released` format: sheet `Income`, header at the row containing `orderid`, charges as positive magnitudes). Exports `SettlementOrder`, `SettlementParseResult { orders, totalNetReleased }`. Imports `normalizeHeader` (`./headerUtils`), `isTikTokSettlement` (`./marketplaceFormat`), `TIKTOK_COLUMN_TO_KEY`/`SettlementFeeKey` (`./settlementMapping`).
- `src/utils/marketplaceFormat.ts` — `isTikTokSettlement(sheetNames)` (currently checks Shopee sheets `Summary`/`Income`/`Adjustment`).
- `src/components/integrations/SettlementImportModal.tsx` — imports `parseTikTokSettlement` + `SettlementParseResult`; calls the parser on upload (`const res = await parseTikTokSettlement(f)`), stores `parsed`, shows preview → done.
- Tests: `src/utils/__tests__/tiktokSettlement.test.ts`, `src/utils/__tests__/settlementMapping.test.ts`.

## Real TikTok `income_*.xlsx` format (verified)
- Sheets: `Detail pesanan`, `Laporan`, `Riwayat penarikan`, `Penjelasan tentang biaya`.
- `Detail pesanan`: **header on row 0**, ~80 Indonesian columns. Key columns: `ID Pesanan/Penyesuaian` (order key), `Jenis transaksi` (`Pesanan` = order; others = adjustments), `Jumlah penyelesaian pembayaran` (net released). Fee columns (charges stored negative): `Biaya komisi platform`, `Komisi Afiliasi`, `Biaya Pembayaran`, `Biaya pemrosesan pesanan`, `Diskon penjual`, `Biaya layanan logistik`, `Ongkir`, `PPh Pasal 22 dipungut`, …
- Rows: mostly `Pesanan`; a few non-order (`Pembayaran GMV untuk Iklan TikTok`, `Penggantian Biaya Logistik`).

---

## Task 1: Rename the Shopee parser/detection/mapping + add `nonOrderRows` to the shared type

**Files:** rename `src/utils/tiktokSettlement.ts`→`src/utils/shopeeSettlement.ts`; modify `src/utils/settlementMapping.ts`, `src/utils/marketplaceFormat.ts`, `src/components/integrations/SettlementImportModal.tsx`; rename test `src/utils/__tests__/tiktokSettlement.test.ts`→`shopeeSettlement.test.ts`.

- [ ] **Step 1: Rename the mapping export.** In `src/utils/settlementMapping.ts`, rename `TIKTOK_COLUMN_TO_KEY` → `SHOPEE_COLUMN_TO_KEY` (keep the same entries).
- [ ] **Step 2: Rename the detector.** In `src/utils/marketplaceFormat.ts`, rename `isTikTokSettlement` → `isShopeeSettlement` (same body — checks `Summary`/`Income`/`Adjustment`).
- [ ] **Step 3: Rename the parser file + symbols.** `git mv src/utils/tiktokSettlement.ts src/utils/shopeeSettlement.ts`. Inside it: `parseTikTokSettlement`→`parseShopeeSettlement`; update its imports to `isShopeeSettlement` and `SHOPEE_COLUMN_TO_KEY`. Extend `SettlementParseResult` to include `nonOrderRows: Array<{ orderId: string; type: string; amount: number }>` and return `nonOrderRows: []` from `parseShopeeSettlement`:
```typescript
export interface SettlementParseResult {
  orders: Array<{ orderId: string; netReleased: number; charges: Partial<Record<SettlementFeeKey, number>> }>;
  totalNetReleased: number;
  nonOrderRows: Array<{ orderId: string; type: string; amount: number }>;
}
// ...at the end of parseShopeeSettlement:
return { orders, totalNetReleased: orders.reduce((s, o) => s + o.netReleased, 0), nonOrderRows: [] };
```
- [ ] **Step 4: Update the wizard import/call.** In `src/components/integrations/SettlementImportModal.tsx`, change `import { parseTikTokSettlement, type SettlementParseResult } from '../../utils/tiktokSettlement'` → `import { parseShopeeSettlement, type SettlementParseResult } from '../../utils/shopeeSettlement'` and the call site `parseTikTokSettlement(f)` → `parseShopeeSettlement(f)`. (Routing is added in Task 4; for now it stays a direct Shopee call — no behavior change.)
- [ ] **Step 5: Rename + update the test.** `git mv src/utils/__tests__/tiktokSettlement.test.ts src/utils/__tests__/shopeeSettlement.test.ts`. Update its import to `parseShopeeSettlement` from `../shopeeSettlement`; keep the existing 2 cases; add `expect(res.nonOrderRows).toEqual([])` to the happy-path case. Also update `settlementMapping.test.ts` references from `TIKTOK_COLUMN_TO_KEY` → `SHOPEE_COLUMN_TO_KEY`.
- [ ] **Step 6: Verify.** `npx vitest run src/utils/__tests__/shopeeSettlement.test.ts src/utils/__tests__/settlementMapping.test.ts` → PASS. `grep -rn "parseTikTokSettlement\|TIKTOK_COLUMN_TO_KEY\|isTikTokSettlement" src` → NO matches (all renamed). `npx tsc --noEmit` → 0 errors.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(settlement): rename mislabeled TikTok parser to Shopee (+ nonOrderRows)"`

---

## Task 2: TikTok column → canonical-key mapping

**Files:** modify `src/utils/settlementMapping.ts`; test `src/utils/__tests__/settlementMapping.test.ts`.

- [ ] **Step 1: Write the failing test** (append a case):
```typescript
import { TIKTOK_COLUMN_TO_KEY } from '../settlementMapping';
it('maps TikTok Indonesian columns to canonical keys', () => {
  expect(TIKTOK_COLUMN_TO_KEY['biayakomisiplatform']).toBe('commissionFee');
  expect(TIKTOK_COLUMN_TO_KEY['komisiafiliasi']).toBe('serviceFee');
  expect(TIKTOK_COLUMN_TO_KEY['diskonpenjual']).toBe('sellerPromotion');
  expect(TIKTOK_COLUMN_TO_KEY['pphpasal22dipungut']).toBe('customTax');
});
```
- [ ] **Step 2: Run → FAIL** (`TIKTOK_COLUMN_TO_KEY` no longer exists — it was renamed in Task 1).
- [ ] **Step 3: Add the NEW `TIKTOK_COLUMN_TO_KEY`** to `settlementMapping.ts` (normalized Indonesian header → canonical key; the service's plug absorbs unmapped columns):
```typescript
export const TIKTOK_COLUMN_TO_KEY: Record<string, SettlementFeeKey> = {
  biayakomisiplatform: 'commissionFee',
  biayakomisisebelumdiskon: 'commissionFee',
  komisiafiliasi: 'serviceFee',
  komisimitraafiliasi: 'serviceFee',
  biayapembayaran: 'transactionFee',
  biayapemrosesanpesanan: 'orderProcessingFee',
  diskonpenjual: 'sellerPromotion',
  biayalayananlogistik: 'actualShipping',
  ongkir: 'actualShipping',
  pphpasal22dipungut: 'customTax',
};
```
- [ ] **Step 4: Run → PASS.** `npx vitest run src/utils/__tests__/settlementMapping.test.ts`
- [ ] **Step 5: `npx tsc --noEmit`** → 0. **Commit:** `git add src/utils/settlementMapping.ts src/utils/__tests__/settlementMapping.test.ts && git commit -m "feat(settlement): TikTok column->key mapping"`

---

## Task 3: TikTok parser + detection

**Files:** modify `src/utils/marketplaceFormat.ts`; create `src/utils/tiktokSettlement.ts`; test `src/utils/__tests__/tiktokSettlement.test.ts`.

- [ ] **Step 1: Add the TikTok detector** to `src/utils/marketplaceFormat.ts`:
```typescript
export function isTikTokSettlement(sheetNames: string[]): boolean {
  const s = new Set(sheetNames);
  return s.has('Detail pesanan') && s.has('Laporan');
}
```
- [ ] **Step 2: Write the parser test** `src/utils/__tests__/tiktokSettlement.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseTikTokSettlement } from '../tiktokSettlement';

function fakeTikTok(): File {
  const detail: unknown[][] = [
    ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Jumlah penyelesaian pembayaran', 'Biaya komisi platform', 'Komisi Afiliasi', 'Diskon penjual'],
    ['ORD1', 'Pesanan', 44885, -3069, -2046, -1000],
    ['ADJ1', 'Pembayaran GMV untuk Iklan TikTok', -11100000, 0, 0, 0],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), 'Detail pesanan');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Laporan']]), 'Laporan');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'income_TIKTOK.xlsx');
}

describe('parseTikTokSettlement', () => {
  it('extracts Pesanan orders with mapped charges + net; reports non-order rows', async () => {
    const res = await parseTikTokSettlement(fakeTikTok());
    expect(res.orders).toHaveLength(1);
    const o = res.orders[0];
    expect(o.orderId).toBe('ORD1');
    expect(o.netReleased).toBe(44885);
    expect(o.charges.commissionFee).toBe(3069);
    expect(o.charges.serviceFee).toBe(2046);
    expect(o.charges.sellerPromotion).toBe(1000);
    expect(res.nonOrderRows).toEqual([{ orderId: 'ADJ1', type: 'Pembayaran GMV untuk Iklan TikTok', amount: -11100000 }]);
  });
  it('rejects a non-TikTok workbook', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Order ID']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await expect(parseTikTokSettlement(new File([buf], 'x.xlsx'))).rejects.toThrow();
  });
});
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `src/utils/tiktokSettlement.ts`:**
```typescript
import * as XLSX from 'xlsx';
import { normalizeHeader } from './headerUtils';
import { isTikTokSettlement } from './marketplaceFormat';
import { TIKTOK_COLUMN_TO_KEY, SettlementFeeKey } from './settlementMapping';
import type { SettlementParseResult } from './shopeeSettlement';

export async function parseTikTokSettlement(file: File): Promise<SettlementParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!isTikTokSettlement(wb.SheetNames)) {
    throw new Error('This does not look like a TikTok settlement statement (expected a "Detail pesanan" sheet).');
  }
  const ws = wb.Sheets['Detail pesanan'];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const header = (rows[0] as unknown[]).map((c) => normalizeHeader(String(c ?? '')));
  const orderCol = header.indexOf('idpesananpenyesuaian');
  const typeCol = header.indexOf('jenistransaksi');
  const netCol = header.indexOf('jumlahpenyelesaianpembayaran');
  if (orderCol < 0 || typeCol < 0 || netCol < 0) throw new Error('TikTok Detail pesanan sheet is missing expected columns.');

  const orders: SettlementParseResult['orders'] = [];
  const nonOrderRows: SettlementParseResult['nonOrderRows'] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const orderId = String(row[orderCol] ?? '').trim();
    if (!orderId) continue;
    const type = String(row[typeCol] ?? '').trim();
    const net = Number(row[netCol] ?? 0);
    if (type !== 'Pesanan') { nonOrderRows.push({ orderId, type, amount: net }); continue; }
    const charges: Partial<Record<SettlementFeeKey, number>> = {};
    header.forEach((h, col) => {
      const key = TIKTOK_COLUMN_TO_KEY[h];
      if (!key) return;
      const v = Number(row[col] ?? 0);
      if (!v) return;
      charges[key] = (charges[key] ?? 0) + Math.abs(v);
    });
    orders.push({ orderId, netReleased: net, charges });
  }
  return { orders, totalNetReleased: orders.reduce((s, o) => s + o.netReleased, 0), nonOrderRows };
}
```
- [ ] **Step 5: Run → PASS.** Also run the Shopee parser test + format test (`npx vitest run src/utils/__tests__/`) — all green. `npx tsc --noEmit` → 0.
- [ ] **Step 6: Commit.** `git add src/utils/tiktokSettlement.ts src/utils/marketplaceFormat.ts src/utils/__tests__/tiktokSettlement.test.ts && git commit -m "feat(settlement): real TikTok income parser + detection"`

---

## Task 4: Wizard format routing + non-order display

**Files:** modify `src/components/integrations/SettlementImportModal.tsx`, `src/views/integrations/Integrations.tsx`. UI — verify with tsc + preview (controller handles visual).

The wizard must know the store's `platform` to validate the uploaded format. `Integrations.tsx` already has the connection row.

- [ ] **Step 1: Pass the platform into the modal.** In `src/views/integrations/Integrations.tsx`, where `SettlementImportModal` is rendered, also pass the selected shop's platform. Look up the shop by `settlementShopId` (the shops list is already in scope) and pass `platform={shop?.platform ?? ''}`. Add `platform: string` to the modal's props.
- [ ] **Step 2: Route by detected format** in `SettlementImportModal.tsx`'s upload handler. Read the workbook sheet names first, pick the parser, and validate against `platform`:
```typescript
import * as XLSX from 'xlsx';
import { isShopeeSettlement, isTikTokSettlement } from '../../utils/marketplaceFormat';
import { parseShopeeSettlement } from '../../utils/shopeeSettlement';
import { parseTikTokSettlement } from '../../utils/tiktokSettlement';
// inside handleFile(f):
const buf = await f.arrayBuffer();
const sheets = XLSX.read(buf, { type: 'array' }).SheetNames;
const detected = isShopeeSettlement(sheets) ? 'Shopee' : isTikTokSettlement(sheets) ? 'TikTok' : null;
if (!detected) { setError('Unrecognised settlement file — expected a Shopee (Income.released) or TikTok (income_) statement.'); return; }
if (platform && detected !== platform) { setError(`This looks like a ${detected} settlement, but the store is ${platform}. Upload the matching file.`); return; }
const parsed = detected === 'Shopee' ? await parseShopeeSettlement(f) : await parseTikTokSettlement(f);
setParsed(parsed); setStep('preview');
```
(Keep the existing try/catch around parsing so a malformed file shows its error.)
- [ ] **Step 2b: Show `nonOrderRows`** in the preview step (a small note: "N non-order rows (ads/adjustments) will be listed, not posted — book them manually") and in the done step render a scrollable list of `parsed.nonOrderRows` (type + `formatIDR(amount)`) alongside the posted/skipped/failed lists. `parsed` is available in both steps.
- [ ] **Step 3: Verify.** `npx tsc --noEmit` → 0 errors. Grep the modal for no leftover unconditional `parseShopeeSettlement`-only path.
- [ ] **Step 4: Commit.** `git add src/components/integrations/SettlementImportModal.tsx src/views/integrations/Integrations.tsx && git commit -m "feat(settlement): wizard routes Shopee/TikTok by format + lists non-order rows"`

---

## Final Verification

- [ ] `npm test` (unit) green · `npm run test:int` green (settlement service unchanged — no regressions) · `npx tsc --noEmit` 0 errors.
- [ ] `grep -rn "parseTikTokSettlement\|isTikTokSettlement\|TIKTOK_COLUMN_TO_KEY" src` now resolves to the REAL TikTok code only; no dangling references to the old Shopee-as-TikTok names.
- [ ] Manual (dev preview): Integrations → a Shopee store's "Import Settlement" accepts an `Income.released` file and rejects a TikTok `income_` one (and vice-versa); a TikTok import shows the non-order rows in the done summary.
- [ ] Update **PR #93** title/body to "Shopee + TikTok settlement import" (controller does this after merge-readiness).

## Notes / deferred
- TikTok non-order auto-posting; Shopee `Adjustment`/`Seller Fee` detail; ad-spend account slot; settlement-history screen; Tokopedia/Lazada formats.
