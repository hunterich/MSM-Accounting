# TikTok Settlement-Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a TikTok `Income.released…` settlement statement and, per settled order, book the platform fees against the e-commerce wallet (`holdingAccount`) — dropping the wallet from the order's gross to its net released — matching each order by `Order ID` → the invoice ② created (`poNumber`); unmatched settled orders are skipped + reported.

**Architecture:** Mirrors ② (the order-import feature already merged). A client-side parser (`src/utils/tiktokSettlement.ts`) reads the multi-sheet settlement file and sends per-order fee rows to a new endpoint `POST /api/v1/integrations/[id]/settlement-import`, which calls a reconciliation service (`lib/settlement-import.ts`). The service matches each order, computes the journal (fee lines from the connection's form-configured `ShopMappings` accounts, a wallet credit of `X − N`, an adjustment plug), and posts it with `postJournalEntry`. Idempotency via new `settledAt` / `settlementJournalId` fields on the order's `ARPayment` receipt.

**Tech Stack:** Next.js route handlers, Prisma + Postgres (`prisma db push`, no migration files), Zod schemas in `types/api.ts`, Vitest unit + real-Postgres integration harness (`npm run test:int`), React + React Query, `xlsx` (SheetJS).

**Reference spec:** `docs/superpowers/specs/2026-06-29-tiktok-settlement-import-design.md`

## Verified integration points (from code)

- **GL poster:** `postJournalEntry(tx, { organizationId, date, memo, source?, lines })` in `lib/journal-posting.ts` — `lines: { accountId, description, debit, credit }[]`; validates debit=credit (0.005 tol); returns `{ id, entryNo }`.
- **Mirror orchestrator:** `lib/marketplace-import.ts` — per-order `prisma.$transaction` returning a discriminator, result accumulation, `loadBankPostingContext(prisma, orgId)` + `resolveBankLinkedAssetAccountId(ctx.bankAccounts, ctx.accounts, ctx.settings, conn.holdingAccountId)` to resolve the wallet GL asset account (imports: `./bank-transaction-posting`, `./account-defaults`).
- **Find ②'s receipt for an order:** `SalesInvoice.findFirst({ where: { organizationId, poNumber, status: { not: 'VOID' } }, select: { id, totalAmount } })` → that `totalAmount` is **X** (what ② parked in the wallet). (The wallet credit = `X − N`; we don't need the ARPayment amount, but we DO need the receipt to stamp idempotency — find it via `aRPaymentAllocation.findFirst({ where: { invoiceId }, select: { paymentId } })`.)
- **ShopMappings:** `conn.mappings` is JSON; read with `conn.mappings as Record<string, unknown>` then nested `.fees`/`.shipping`/`.others` objects of account-id strings (see `lib/marketplace-import.ts:79-91` for the cast pattern). Type `ShopMappings` in `src/types/index.ts`.
- **ARPayment / JournalEntry models:** `prisma/schema.prisma:630-657` / `:222-252`.
- **Endpoint/hook/wizard to mirror:** `src/app/api/v1/integrations/[id]/import/route.ts`, `useImportMarketplaceOrders` (`src/hooks/useIntegrations.ts:158`), `ImportInvoicesModal.tsx`, `src/views/integrations/Integrations.tsx:63-93` (actions column).
- **Parser/detection:** `XLSX.read(buf, { type: 'array' })`; `PLATFORM_SIGNATURES`/`detectPlatformFromHeaders` in `src/utils/marketplaceFormat.ts`.

## Settlement file shape (verified from a real file)

TikTok `Income.released….xlsx`: sheets `Summary`, `Income`, `Adjustment`, `Seller Fee`. The **Income** sheet's real header is at **row index 5** (6th row); per-order data rows follow. Relevant columns by header name: `Order ID`; fee/money columns `Your Seller product promotion`, `Refund Amount`, `Rebate Provided by Shopee`, `Voucher Sponsored by Seller`, `Coin Cashback Sponsored by Seller`, `Shipping Fee Paid by Buyer`, `Shipping Rebate From Shopee`, `Actual Shipping Fee`, `AMS Commission Fee`, `Commission fee`, `Service Fee`, `Seller Order Processing Fee`, `Transaction Fee`, `Campaign Fee`, `Custom Tax`; and the per-order net **`Total Released Amount (Rp)`**. Charges are stored as **negative** numbers; rebates/income as positive.

## Canonical fee keys + slot routing (the contract shared by parser → service)

```ts
// src/utils/settlementMapping.ts
export type SettlementFeeKey =
  | 'commissionFee' | 'serviceFee' | 'orderProcessingFee' | 'transactionFee' | 'campaignFee'
  | 'sellerPromotion' | 'refund' | 'buyerShipping' | 'actualShipping' | 'shippingRebate'
  | 'sellerVoucher' | 'platformRebate' | 'coinCashback' | 'customTax';

// TikTok Income column header (normalized) → canonical key
export const TIKTOK_COLUMN_TO_KEY: Record<string, SettlementFeeKey> = {
  'amscommissionfee': 'commissionFee', 'commissionfee': 'commissionFee',
  'servicefee': 'serviceFee', 'sellerorderprocessingfee': 'orderProcessingFee',
  'transactionfee': 'transactionFee', 'campaignfee': 'campaignFee',
  'yoursellerproductpromotion': 'sellerPromotion', 'refundamount': 'refund',
  'shippingfeepaidbybuyer': 'buyerShipping', 'actualshippingfee': 'actualShipping',
  'shippingrebatefromshopee': 'shippingRebate',
  'vouchersponsoredbyseller': 'sellerVoucher', 'rebateprovidedbyshopee': 'platformRebate',
  'coincashbacksponsoredbyseller': 'coinCashback', 'customtax': 'customTax',
};

// canonical key → ShopMappings slot path (the account is whatever the operator configured there)
export const KEY_TO_SLOT: Record<SettlementFeeKey, [group: 'fees' | 'shipping' | 'others', field: string]> = {
  commissionFee: ['fees', 'platformFeeAccountId'], serviceFee: ['fees', 'affiliateFeeAccountId'],
  orderProcessingFee: ['fees', 'platformFeeAccountId'], transactionFee: ['fees', 'platformFeeAccountId'],
  campaignFee: ['fees', 'platformFeeAccountId'], sellerPromotion: ['fees', 'sellerDiscountAccountId'],
  refund: ['others', 'refundAccountId'], buyerShipping: ['shipping', 'buyerShippingRevenueAccountId'],
  actualShipping: ['shipping', 'actualShippingCostAccountId'], shippingRebate: ['shipping', 'platformShippingSubsidyAccountId'],
  sellerVoucher: ['others', 'sellerVoucherAccountId'], platformRebate: ['others', 'platformVoucherAccountId'],
  coinCashback: ['others', 'coinCashbackAccountId'], customTax: ['others', 'withholdingTaxAccountId'],
};
```
The importer reads the GL account for each key from `mappings[group][field]`; if unset, it routes that amount to `mappings.fees.adjustmentAccountId` (and the journal still balances).

---

## File Structure

**Create:** `src/utils/settlementMapping.ts` (keys + routing), `src/utils/tiktokSettlement.ts` (parser), `lib/settlement-import.ts` (reconciliation service), `src/app/api/v1/integrations/[id]/settlement-import/route.ts`, `src/components/integrations/SettlementImportModal.tsx`, test files.
**Modify:** `prisma/schema.prisma` (ARPayment + JournalEntry), `types/api.ts` (input schema), `src/utils/marketplaceFormat.ts` (settlement detection), `src/hooks/useIntegrations.ts` (hook), `src/views/integrations/Integrations.tsx` (button).

---

## Task 1: Schema — settlement fields on ARPayment

**Files:** Modify `prisma/schema.prisma` (ARPayment ~630-657, JournalEntry ~222-252).

- [ ] **Step 1:** In the `ARPayment` model, add after `journalEntryId`:
```prisma
  settledAt           DateTime?
  settlementJournalId String?       @unique
  settlementJournal   JournalEntry? @relation("ARPaymentSettlement", fields: [settlementJournalId], references: [id], onDelete: SetNull)
```
- [ ] **Step 2:** In the `JournalEntry` model, add the back-relation among its relations:
```prisma
  arPaymentSettlement ARPayment? @relation("ARPaymentSettlement")
```
- [ ] **Step 3:** Apply + regenerate:
```bash
npx prisma db push && npx prisma generate
```
Expected: "Your database is now in sync", client regenerated, 0 errors.
- [ ] **Step 4:** Typecheck: `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5:** Commit: `git add prisma/schema.prisma && git commit -m "feat(settlement): add settledAt/settlementJournalId to ARPayment"`

---

## Task 2: Settlement slot mapping module

**Files:** Create `src/utils/settlementMapping.ts`; Test `src/utils/__tests__/settlementMapping.test.ts`.

- [ ] **Step 1: Write failing test:**
```typescript
import { describe, it, expect } from 'vitest';
import { TIKTOK_COLUMN_TO_KEY, KEY_TO_SLOT } from '../settlementMapping';

describe('settlement mapping', () => {
  it('routes a TikTok column to a canonical key to a ShopMappings slot', () => {
    expect(TIKTOK_COLUMN_TO_KEY['commissionfee']).toBe('commissionFee');
    expect(KEY_TO_SLOT['commissionFee']).toEqual(['fees', 'platformFeeAccountId']);
    expect(KEY_TO_SLOT['serviceFee']).toEqual(['fees', 'affiliateFeeAccountId']);
  });
});
```
- [ ] **Step 2:** Run → FAIL: `npx vitest run src/utils/__tests__/settlementMapping.test.ts`
- [ ] **Step 3:** Create `src/utils/settlementMapping.ts` with the `SettlementFeeKey` type, `TIKTOK_COLUMN_TO_KEY`, and `KEY_TO_SLOT` exactly as in the "Canonical fee keys" block above.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `git add src/utils/settlementMapping.ts src/utils/__tests__/settlementMapping.test.ts && git commit -m "feat(settlement): canonical fee-key + slot routing table"`

---

## Task 3: Settlement parser + format detection

**Files:** Create `src/utils/tiktokSettlement.ts`; Modify `src/utils/marketplaceFormat.ts`; Test `src/utils/__tests__/tiktokSettlement.test.ts`.

- [ ] **Step 1: Add a settlement format detector.** In `src/utils/marketplaceFormat.ts`, add:
```typescript
export function isTikTokSettlement(sheetNames: string[]): boolean {
  const s = new Set(sheetNames);
  return s.has('Summary') && s.has('Income') && s.has('Adjustment');
}
```
- [ ] **Step 2: Write the parser test** (synthetic workbook via the `xlsx` lib so no real file is needed):
```typescript
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseTikTokSettlement } from '../tiktokSettlement';

function fakeSettlement(): File {
  const income: unknown[][] = [
    ['Username (Seller)', 'From', 'to'], ['x', '2026-06-15', '2026-06-21'], [], [], ['subtotal(Rp)'],
    ['Sequence No.', 'Order ID', 'Commission fee', 'Service Fee', 'Total Released Amount (Rp)'],
    [1, 'ORD1', -3069, -2046, 30832],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(income), 'Income');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Income Report']]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Note']]), 'Adjustment');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'Income.released.id.xlsx');
}

describe('parseTikTokSettlement', () => {
  it('extracts per-order net released + canonical fee amounts (charges are positive magnitudes)', async () => {
    const res = await parseTikTokSettlement(fakeSettlement());
    expect(res.orders).toHaveLength(1);
    const o = res.orders[0];
    expect(o.orderId).toBe('ORD1');
    expect(o.netReleased).toBe(30832);
    // negative charges become positive "amounts" keyed canonically
    expect(o.charges.commissionFee).toBe(3069);
    expect(o.charges.serviceFee).toBe(2046);
  });
  it('rejects a non-settlement workbook', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Order ID']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await expect(parseTikTokSettlement(new File([buf], 'x.xlsx'))).rejects.toThrow();
  });
});
```
- [ ] **Step 2b:** Run → FAIL.
- [ ] **Step 3: Implement `src/utils/tiktokSettlement.ts`:**
```typescript
import * as XLSX from 'xlsx';
import { normalizeHeader } from './headerUtils';
import { isTikTokSettlement } from './marketplaceFormat';
import { TIKTOK_COLUMN_TO_KEY, SettlementFeeKey } from './settlementMapping';

export interface SettlementOrder {
  orderId: string;
  netReleased: number;
  charges: Partial<Record<SettlementFeeKey, number>>; // positive magnitudes
}
export interface SettlementParseResult {
  orders: SettlementOrder[];
  totalNetReleased: number;
}

export async function parseTikTokSettlement(file: File): Promise<SettlementParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!isTikTokSettlement(wb.SheetNames)) {
    throw new Error('This does not look like a TikTok settlement statement (expected Summary/Income/Adjustment sheets).');
  }
  const ws = wb.Sheets['Income'];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  // Find the header row: the one containing a normalized 'orderid' cell.
  const headerIdx = rows.findIndex((r) => r.some((c) => normalizeHeader(String(c ?? '')) === 'orderid'));
  if (headerIdx < 0) throw new Error('Income sheet has no Order ID column.');
  const header = rows[headerIdx].map((c) => normalizeHeader(String(c ?? '')));
  const orderCol = header.indexOf('orderid');
  const netCol = header.findIndex((h) => h === normalizeHeader('Total Released Amount (Rp)'));

  const orders: SettlementOrder[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const orderId = String(row[orderCol] ?? '').trim();
    if (!orderId || !/\d/.test(orderId)) continue; // skip blanks / description rows
    const charges: Partial<Record<SettlementFeeKey, number>> = {};
    header.forEach((h, col) => {
      const key = TIKTOK_COLUMN_TO_KEY[h];
      if (!key) return;
      const v = Number(row[col] ?? 0);
      if (!v) return;
      charges[key] = (charges[key] ?? 0) + Math.abs(v); // store magnitude; sign is decided by routing
    });
    orders.push({ orderId, netReleased: Number(row[netCol] ?? 0), charges });
  }
  return { orders, totalNetReleased: orders.reduce((s, o) => s + o.netReleased, 0) };
}
```
- [ ] **Step 4:** Run → PASS: `npx vitest run src/utils/__tests__/tiktokSettlement.test.ts`. Then run the existing format tests `npx vitest run src/utils/__tests__/marketplaceFormat.test.ts` (still green) and `npx tsc --noEmit` (0 errors).
- [ ] **Step 5:** Commit: `git add src/utils/tiktokSettlement.ts src/utils/marketplaceFormat.ts src/utils/__tests__/tiktokSettlement.test.ts && git commit -m "feat(settlement): TikTok settlement parser + format detection"`

> Note: charges are stored as positive magnitudes; the service decides Dr/Cr per slot (most are expense debits; `buyerShipping`/`platformRebate`/`shippingRebate` are income credits — see Task 5).

---

## Task 4: Settlement input schema

**Files:** Modify `types/api.ts`; Test `src/utils/__tests__/settlementSchema.test.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { describe, it, expect } from 'vitest';
import { settlementImportInputSchema } from '@/types/api';
describe('settlementImportInputSchema', () => {
  it('accepts a settlement batch', () => {
    const r = settlementImportInputSchema.safeParse({
      orders: [{ orderId: 'ORD1', netReleased: 30832, charges: { commissionFee: 3069 } }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects an empty batch', () => {
    expect(settlementImportInputSchema.safeParse({ orders: [] }).success).toBe(false);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add to `types/api.ts` (reuse `z`):
```typescript
export const settlementImportInputSchema = z.object({
  orders: z.array(z.object({
    orderId: z.string().trim().min(1),
    netReleased: z.number(),
    charges: z.record(z.string(), z.number()).default({}),
  })).min(1),
});
export type SettlementImportInput = z.infer<typeof settlementImportInputSchema>;
```
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` → 0.
- [ ] **Step 5:** Commit: `git add types/api.ts src/utils/__tests__/settlementSchema.test.ts && git commit -m "feat(types): settlementImportInputSchema"`

---

## Task 5: Reconciliation service (the heart)

**Files:** Create `lib/settlement-import.ts`; Test `lib/__tests__/integration/settlement-import.int.test.ts`.

The per-order journal (wallet model): **X** = matched invoice `totalAmount`; **N** = `netReleased`. For each `charges[key]` (positive magnitude), look up the GL account via `KEY_TO_SLOT[key]` → `mappings[group][field]` (fallback `fees.adjustmentAccountId`); income keys (`buyerShipping`, `shippingRebate`, `platformRebate`) post as **credits**, all others as **debits**. Then **Cr wallet `(X − N)`**, and a final **adjustment** line plugs to balance. Post with `postJournalEntry`; stamp `settledAt` + `settlementJournalId` on the order's receipt.

- [ ] **Step 1: Write the integration test** (reuse the ② harness + `importMarketplaceOrders` to seed a real imported order with its wallet receipt, then settle it). Mirror `lib/__tests__/integration/marketplace-import.int.test.ts` for the seed helpers (`createTestOrg`, `assertTrialBalanced`, `cleanupOrg`, plus seeding an EcommerceConnection with `mappings.fees.*` account ids pointing at real expense accounts):
```typescript
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { importMarketplaceOrders } from '@/lib/marketplace-import';
import { importSettlement } from '@/lib/settlement-import';
// reuse harness: createTestOrg, assertTrialBalanced, cleanupOrg, disconnect, seedExpenseAccount, seedConnectionWithMappings

describe('importSettlement', () => {
  it('books fees against the wallet, leaves net in the wallet, balances, and stamps settledAt', async () => {
    const env = await seedImportedOrder(); // org + connection(mappings) + item + ② import of order 'ORD1' gross 50000
    const res = await importSettlement(env.orgId, env.userId, env.connectionId, {
      orders: [{ orderId: 'ORD1', netReleased: 44885, charges: { commissionFee: 3069, serviceFee: 2046 } }],
    });
    expect(res.posted).toBe(1);
    await assertTrialBalanced(env.orgId);
    const pay = await prisma.aRPayment.findFirst({ where: { organizationId: env.orgId }, select: { settledAt: true, settlementJournalId: true } });
    expect(pay?.settledAt).not.toBeNull();
    expect(pay?.settlementJournalId).not.toBeNull();
  });
  it('skips a settled order with no matching invoice', async () => {
    const env = await seedImportedOrder();
    const res = await importSettlement(env.orgId, env.userId, env.connectionId, {
      orders: [{ orderId: 'NOPE', netReleased: 1000, charges: {} }],
    });
    expect(res.posted).toBe(0);
    expect(res.skipped).toEqual([{ orderId: 'NOPE', netReleased: 1000 }]);
  });
  it('is idempotent — re-settling the same order does not double-post', async () => {
    const env = await seedImportedOrder();
    const batch = { orders: [{ orderId: 'ORD1', netReleased: 44885, charges: { commissionFee: 3069 } }] };
    await importSettlement(env.orgId, env.userId, env.connectionId, batch);
    const res2 = await importSettlement(env.orgId, env.userId, env.connectionId, batch);
    expect(res2.posted).toBe(0);
    expect(res2.alreadySettled).toBe(1);
  });
});
```
(Write the `seedImportedOrder`/`seedConnectionWithMappings`/`seedExpenseAccount` helpers in the test file, leaning on the existing harness exports — read `marketplace-import.int.test.ts` to match the harness API.)
- [ ] **Step 2:** Run → FAIL: `npx vitest run --config vitest.integration.config.ts lib/__tests__/integration/settlement-import.int.test.ts`
- [ ] **Step 3: Implement `lib/settlement-import.ts`:**
```typescript
import { prisma } from '@/lib/prisma';
import { postJournalEntry, JournalLineInput } from '@/lib/journal-posting';
import { KEY_TO_SLOT, SettlementFeeKey } from '@/src/utils/settlementMapping';
import { loadBankPostingContext } from '@/lib/bank-transaction-posting';
import { resolveBankLinkedAssetAccountId } from '@/lib/account-defaults';

const INCOME_KEYS: SettlementFeeKey[] = ['buyerShipping', 'shippingRebate', 'platformRebate'];

export interface SettlementOrderInput { orderId: string; netReleased: number; charges: Record<string, number>; }
export interface SettlementResult {
  posted: number; alreadySettled: number;
  skipped: Array<{ orderId: string; netReleased: number }>;
}

export async function importSettlement(
  orgId: string, userId: string, connectionId: string,
  input: { orders: SettlementOrderInput[] },
): Promise<SettlementResult> {
  const conn = await prisma.ecommerceConnection.findFirst({ where: { id: connectionId, organizationId: orgId } });
  if (!conn) throw new Error('Connection not found');
  if (!conn.holdingAccountId) throw new Error('Connection has no settlement/holding account');

  const ctx = await loadBankPostingContext(prisma, orgId);
  const walletAccountId = resolveBankLinkedAssetAccountId(ctx.bankAccounts, ctx.accounts, ctx.settings, conn.holdingAccountId);
  if (!walletAccountId) throw new Error('Could not resolve the wallet GL account');

  const m = (conn.mappings && typeof conn.mappings === 'object' && !Array.isArray(conn.mappings))
    ? conn.mappings as Record<string, Record<string, string | null>> : {};
  const adjustmentAccountId = m.fees?.adjustmentAccountId || null;
  const accountFor = (key: SettlementFeeKey): string | null => {
    const [group, field] = KEY_TO_SLOT[key];
    return (m[group]?.[field] as string) || adjustmentAccountId;
  };

  const result: SettlementResult = { posted: 0, alreadySettled: 0, skipped: [] };

  for (const order of input.orders) {
    const outcome = await prisma.$transaction(async (tx): Promise<'posted' | 'skipped' | 'already'> => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { organizationId: orgId, poNumber: order.orderId, status: { not: 'VOID' } },
        select: { id: true, number: true, totalAmount: true },
      });
      if (!invoice) return 'skipped';
      const alloc = await tx.aRPaymentAllocation.findFirst({ where: { invoiceId: invoice.id }, select: { paymentId: true } });
      if (!alloc) return 'skipped'; // no ② receipt → nothing parked in the wallet to clear
      const receipt = await tx.aRPayment.findUnique({ where: { id: alloc.paymentId }, select: { id: true, settledAt: true } });
      if (!receipt) return 'skipped';
      if (receipt.settledAt) return 'already';

      const X = Number(invoice.totalAmount);
      const N = order.netReleased;
      const lines: JournalLineInput[] = [];
      for (const [k, mag] of Object.entries(order.charges)) {
        const key = k as SettlementFeeKey;
        if (!KEY_TO_SLOT[key] || !mag) continue;
        const acct = accountFor(key);
        if (!acct) continue; // no account + no adjustment fallback → drop into the plug below
        const income = INCOME_KEYS.includes(key);
        lines.push({ accountId: acct, description: `${key} - ${invoice.number}`, debit: income ? 0 : mag, credit: income ? mag : 0 });
      }
      // Wallet drops by X − N.
      lines.push({ accountId: walletAccountId, description: `Wallet settlement - ${invoice.number}`, debit: 0, credit: X - N });
      // Balancing plug → adjustment account.
      const totDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totCredit = lines.reduce((s, l) => s + l.credit, 0);
      const plug = totCredit - totDebit; // if >0 add a debit, else a credit
      if (Math.abs(plug) > 0.005) {
        if (!adjustmentAccountId) throw new Error(`Settlement for ${order.orderId} does not balance and no adjustment account is configured`);
        lines.push({ accountId: adjustmentAccountId, description: `Settlement adjustment - ${invoice.number}`, debit: plug > 0 ? plug : 0, credit: plug < 0 ? -plug : 0 });
      }
      const je = await postJournalEntry(tx, { organizationId: orgId, date: new Date(), memo: `Settlement: ${invoice.number}`, source: 'SYSTEM', lines });
      await tx.aRPayment.update({ where: { id: receipt.id }, data: { settledAt: new Date(), settlementJournalId: je.id } });
      return 'posted';
    });
    if (outcome === 'posted') result.posted += 1;
    else if (outcome === 'already') result.alreadySettled += 1;
    else result.skipped.push({ orderId: order.orderId, netReleased: order.netReleased });
  }
  return result;
}
```
> `date: new Date()` is fine inside the live service (NOT a workflow script). Confirm `@/src/utils/...` import alias resolves server-side (the `@` alias maps to repo root, so `@/src/utils/settlementMapping`); if server lib files import frontend utils awkwardly, move `settlementMapping.ts` to `lib/` instead — decide when implementing and keep one home.
- [ ] **Step 4:** Run the int test → iterate to green. Then full int suite `npm run test:int` (no regressions) + `npx tsc --noEmit`.
- [ ] **Step 5:** Commit: `git add lib/settlement-import.ts lib/__tests__/integration/settlement-import.int.test.ts && git commit -m "feat(settlement): per-order reconciliation service (wallet model, idempotent)"`

---

## Task 6: Endpoint

**Files:** Create `src/app/api/v1/integrations/[id]/settlement-import/route.ts`; Test `src/app/api/v1/__tests__/settlement-import-route.validation.test.ts`.

- [ ] **Step 1:** Mirror `…/import/route.ts` exactly (same auth/params/validation shape):
```typescript
import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireAuth, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { settlementImportInputSchema } from '@/types/api';
import { importSettlement } from '@/lib/settlement-import';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withPermission({ module: 'AR_INVOICES', action: 'create' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { orgId, userId } = requireAuth(req);
    const { id } = await params;
    const parsed = settlementImportInputSchema.safeParse(await req.json());
    if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid settlement payload', 400);
    const result = await importSettlement(orgId, userId, id, parsed.data);
    return ok(result, 200);
  },
);
```
- [ ] **Step 2:** Write a validation test mirroring `bill-imports.validation.test.ts` (empty `orders` → 400). Run → PASS. `npx tsc --noEmit` → 0.
- [ ] **Step 3:** Commit: `git add "src/app/api/v1/integrations/[id]/settlement-import/route.ts" src/app/api/v1/__tests__/settlement-import-route.validation.test.ts && git commit -m "feat(api): POST /integrations/[id]/settlement-import"`

---

## Task 7: Hook

**Files:** Modify `src/hooks/useIntegrations.ts`.

- [ ] **Step 1:** Add (mirror `useImportMarketplaceOrders`):
```typescript
export interface SettlementImportPayload { orders: Array<{ orderId: string; netReleased: number; charges: Record<string, number> }>; }
export interface SettlementImportResult { posted: number; alreadySettled: number; skipped: Array<{ orderId: string; netReleased: number }>; }

export function useImportSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, ...body }: SettlementImportPayload & { connectionId: string }) =>
      api.post<SettlementImportResult>(`/api/v1/integrations/${connectionId}/settlement-import`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arPayments'] }); qc.invalidateQueries({ queryKey: ['banking'] }); },
  });
}
```
(Confirm the banking query key by grepping `src/hooks/useBanking.ts`; if different, match it.)
- [ ] **Step 2:** `npx tsc --noEmit` → 0. Commit: `git add src/hooks/useIntegrations.ts && git commit -m "feat(hooks): useImportSettlement"`

---

## Task 8: Settlement-import wizard + entry button

**Files:** Create `src/components/integrations/SettlementImportModal.tsx`; Modify `src/views/integrations/Integrations.tsx`. UI — verify with tsc + dev-server preview (controller handles visual).

- [ ] **Step 1:** Build `SettlementImportModal.tsx` — props `{ isOpen, connectionId, onClose }`. Steps: **upload** (file input → `parseTikTokSettlement`; on parse error show it), **preview** (show order count, total net released, and how many match existing invoices — optionally a quick client check, else just counts), **importing** (call `useImportSettlement().mutateAsync({ connectionId, orders: parsed.orders })`), **done** (show `posted` / `alreadySettled` / a list of `skipped` orderIds + net). Reuse `Modal`, `Button`, `Table`, the `XLSX`/parser pattern from `ImportInvoicesModal.tsx`. Keep it lean — there's no SKU mapping step here.
- [ ] **Step 2:** In `src/views/integrations/Integrations.tsx`, add state `const [settlementShopId, setSettlementShopId] = useState<string | null>(null)`, an `FileUp` icon button in the actions column (between Settings and Trash, `disabled={!canEdit}`, `onClick={() => setSettlementShopId(row.id)}`), and render `<SettlementImportModal isOpen={!!settlementShopId} connectionId={settlementShopId ?? ''} onClose={() => setSettlementShopId(null)} />`.
- [ ] **Step 3:** `npx tsc --noEmit` → 0. Commit: `git add src/components/integrations/SettlementImportModal.tsx src/views/integrations/Integrations.tsx && git commit -m "feat(settlement): import wizard + Integrations entry button"`

---

## Final Verification

- [ ] `npm test` (unit) green · `npm run test:int` green (balanced trial balance in the settlement scenarios) · `npx tsc --noEmit` 0 errors.
- [ ] Manual (dev preview): on Integrations, click a shop's "Import Settlement", upload a real `Income.released` file → preview → Confirm → done shows posted/skipped; re-import → all `alreadySettled`; the connection's wallet account drops by the fees in the GL.

## Notes / deferred
- Shopee settlement format (next); the Adjustment-sheet period adjustments (post in aggregate) — deferred unless trivial; per-SKU Seller-Fee detail; a settlement-history screen. Schema change → `prisma db push` at deploy.
