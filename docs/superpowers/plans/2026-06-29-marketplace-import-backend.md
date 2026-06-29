# Marketplace Import → Backend Persistence (②.1–②.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Shopee/TikTok import wizard persist real, GL-posted sales to the database (auto-finalized invoices + settlement receipts, idempotent by order number), with platform format detection, SKU cross-check that bulk-creates new master items, and rejection of orders mapped to inactive products.

**Architecture:** A new `POST /api/v1/integrations/[id]/import` endpoint processes a batch of validated, item-mapped orders. For each order it runs one `prisma.$transaction`: idempotency check (by `poNumber`), inactive-product guard, create `SalesInvoice` (DRAFT), finalize to SENT via the existing `postInvoiceSend()` helper (revenue + COGS GL, with an import-scoped `allowNegativeStock` override threaded into `calculateAndPostCOGS()`), then a settlement `ARPayment` posted via `postArPaymentIfNeeded()`. Parsing/preview/mapping stay client-side (reusing `src/utils/shopeeImport.ts`); the wizard's localStorage write path is replaced by a call to the new endpoint.

**Tech Stack:** Next.js App Router (route handlers), Prisma + Postgres, Zod schemas in `src/types/api.ts`, Vitest (unit) + real-Postgres integration harness (`npm run test:int`), React + React Query (`src/hooks`), `xlsx` (SheetJS) for Excel parsing.

**Reference spec:** `docs/superpowers/specs/2026-06-29-marketplace-import-backend-design.md`

**Verified integration points (from code):**
- Invoice finalize/GL: `postInvoiceSend(tx, orgId, invoiceId)` in `lib/invoice-send-posting.ts` (posts AR revenue journal + per-line COGS).
- COGS + oversell: `calculateAndPostCOGS(tx, orgId, itemId, warehouseId, qty, docType, docId, date)` in `lib/inventory-costing.ts`; oversell gated by `assertSufficientStock()` which returns early if `org.allowNegativeStock` (line ~47). No override param today — Task 1 adds one.
- AR receipt GL: `postArPaymentIfNeeded(tx, orgId, paymentId)` in `lib/payment-posting.ts` (Dr bank/deposit, Cr AR).
- Invoice totals: `calculateInvoiceTotals(payload, orgDefaults)` — currently a **local const** in `src/app/api/v1/invoices/route.ts` (~line 112). Task 2 extracts it to a shared lib.
- Schemas: `createInvoiceInputSchema`, `invoiceLineInputSchema`, `arPaymentInputSchema` in `src/types/api.ts`.
- API utils: `withPermission({module,action}, handler)` (`lib/authz.ts`), `requireAuth(req) → {orgId,userId}`, `ok(data,status)`, `err(msg,status)` (`lib/api-utils.ts`).
- Parser: `parseShopeeExcel(file, importStatusFilter)` and `transformOrdersToInvoices(...)` in `src/utils/shopeeImport.ts`; reads `workbook.SheetNames[0]` (Task 5 hardens sheet selection + adds detection).
- Wizard: `src/components/ar/invoices/ImportInvoicesModal.tsx` — steps `['upload','preview','mapping','configure','importing','done']`; writes via `addInvoicesBatch`/`addPaymentsBatch` (Zustand) — replaced in Task 8.

---

## File Structure

**Create:**
- `lib/invoice-totals.ts` — extracted `calculateInvoiceTotals` (shared by the invoices route + import service).
- `lib/marketplace-import.ts` — the import orchestrator: `importMarketplaceOrders(orgId, userId, connectionId, orders, options)` returning `{ created, skipped, failed }`.
- `src/app/api/v1/integrations/[id]/import/route.ts` — POST route wiring auth + the orchestrator.
- `src/utils/marketplaceFormat.ts` — platform fingerprint table + `detectPlatformFromWorkbook(workbook)`.
- `src/hooks/__tests__` / `lib/__tests__/integration/marketplace-import.int.test.ts` — integration tests.
- `src/utils/__tests__/marketplaceFormat.test.ts` — detection unit tests.

**Modify:**
- `lib/inventory-costing.ts` — add `allowNegativeStock?` option to `calculateAndPostCOGS`.
- `lib/invoice-send-posting.ts` — thread `allowNegativeStock?` option into the COGS call.
- `src/app/api/v1/invoices/route.ts` — import `calculateInvoiceTotals` from `lib/invoice-totals.ts` instead of the local const.
- `src/types/api.ts` — add `marketplaceImportInputSchema`.
- `src/utils/shopeeImport.ts` — sheet selection by detected platform; export header signatures.
- `src/components/ar/invoices/ImportInvoicesModal.tsx` — format detection, SKU auto-match + bulk create + inactive flagging, call the endpoint, render done summary.
- `src/hooks/useIntegrations.ts` — add `useImportMarketplaceOrders()` mutation.
- The invoice workbench/list pane area — Import button beside "+ New Invoice" (Task 9).

---

## Task 1: Import-scoped `allowNegativeStock` override in COGS

**Files:**
- Modify: `lib/inventory-costing.ts` (`assertSufficientStock`, `calculateAndPostCOGS`)
- Modify: `lib/invoice-send-posting.ts` (the `calculateAndPostCOGS` call ~line 204-213)
- Test: `lib/__tests__/inventory-costing.test.ts`

- [ ] **Step 1: Write the failing test** — add to `lib/__tests__/inventory-costing.test.ts`, in the `describe('calculateAndPostCOGS overselling guard', ...)` block:

```typescript
it('allows overselling when the caller passes allowNegativeStock override (org flag off)', async () => {
  const tx = makeTx({ allowNegativeStock: false, lots: [{ id: 'L1', qtyBalance: 1, unitCost: 100 }] });
  await expect(
    calculateAndPostCOGS(tx as never, 'org1', 'item1', null, 5, InventoryDocumentType.SALES, 'doc1', new Date(), { allowNegativeStock: true }),
  ).resolves.toBeTypeOf('number');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/inventory-costing.test.ts -t "allowNegativeStock override"`
Expected: FAIL — `calculateAndPostCOGS` currently takes 8 args; the 9th `opts` arg is ignored, so the guard still throws `Insufficient stock`.

- [ ] **Step 3: Add the override param.** In `lib/inventory-costing.ts`, change `assertSufficientStock` to accept an override and short-circuit on it:

```typescript
async function assertSufficientStock(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  allowNegativeStockOverride = false,
): Promise<void> {
  if (allowNegativeStockOverride) return
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { allowNegativeStock: true },
  })
  if (org?.allowNegativeStock) return
  // ...existing available-qty check + throw unchanged...
}
```

Then add an options param to `calculateAndPostCOGS` and pass it through:

```typescript
export async function calculateAndPostCOGS(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date,
  opts: { allowNegativeStock?: boolean } = {},
): Promise<number> {
  await assertSufficientStock(tx, orgId, itemId, warehouseId, qty, opts.allowNegativeStock ?? false)
  // ...rest unchanged...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/inventory-costing.test.ts`
Expected: PASS (new test + all existing overselling-guard tests still green).

- [ ] **Step 5: Thread the option through `postInvoiceSend`.** In `lib/invoice-send-posting.ts`, add an `opts` param to the exported function signature and forward it to `calculateAndPostCOGS`:

```typescript
export async function postInvoiceSend(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  opts: { allowNegativeStock?: boolean } = {},
): Promise<void> {
  // ... inside the per-line loop, change the COGS call to: ...
  const cogs = await calculateAndPostCOGS(
    tx, orgId, line.itemId, null, qty, InventoryDocumentType.SALES, invoiceId, invoiceDate,
    { allowNegativeStock: opts.allowNegativeStock ?? false },
  );
}
```

- [ ] **Step 6: Verify existing callers compile (they pass no opts → default false = unchanged behavior).**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/inventory-costing.ts lib/invoice-send-posting.ts lib/__tests__/inventory-costing.test.ts
git commit -m "feat(inventory): add import-scoped allowNegativeStock override to COGS posting"
```

---

## Task 2: Extract `calculateInvoiceTotals` to a shared lib

**Files:**
- Create: `lib/invoice-totals.ts`
- Modify: `src/app/api/v1/invoices/route.ts` (remove local const, import from lib)
- Test: `lib/__tests__/invoice-totals.test.ts`

- [ ] **Step 1: Move the function.** Cut the entire `const calculateInvoiceTotals = (payload, orgDefaults) => { ... }` block (~lines 112-192) out of `src/app/api/v1/invoices/route.ts` into a new `lib/invoice-totals.ts` as a named export, preserving its body verbatim:

```typescript
// lib/invoice-totals.ts
import { asMoney, toNumber } from '@/lib/money';

export function calculateInvoiceTotals(
  payload: any,
  orgDefaults: { taxEnabled: boolean; taxDefaultRate: unknown; taxInclusiveByDefault: boolean },
) {
  // ...verbatim body from the route, returning
  // { lines, charges, subtotal, discountPct, discountAmount, taxEnabled, taxInclusive, taxRate, taxAmount, totalAmount }
}
```

(Carry over whatever `asMoney`/`toNumber`/helpers the body referenced; check the route's imports.)

- [ ] **Step 2: Import it in the route.** In `src/app/api/v1/invoices/route.ts`, add `import { calculateInvoiceTotals } from '@/lib/invoice-totals';` and delete the local definition.

- [ ] **Step 3: Write a characterization test** — `lib/__tests__/invoice-totals.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateInvoiceTotals } from '../invoice-totals';

describe('calculateInvoiceTotals', () => {
  it('computes subtotal/tax/total for a simple 1-line invoice (tax 11%, exclusive)', () => {
    const t = calculateInvoiceTotals(
      { discountPct: 0, lines: [{ description: 'X', quantity: 2, unit: 'PCS', price: 1000, discountPct: 0 }], tax: { enabled: true, rate: 11, inclusive: false } },
      { taxEnabled: true, taxDefaultRate: 11, taxInclusiveByDefault: false },
    );
    expect(t.subtotal).toBe(2000);
    expect(t.taxAmount).toBe(220);
    expect(t.totalAmount).toBe(2220);
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run lib/__tests__/invoice-totals.test.ts && npx tsc --noEmit`
Expected: PASS, 0 type errors. (Adjust the expected numbers in Step 3 to match the function's actual rounding once you read the body.)

- [ ] **Step 5: Run the existing invoice integration tests to confirm no regression.**

Run: `npm run test:int -- invoices`
Expected: existing invoice create/post tests stay green.

- [ ] **Step 6: Commit**

```bash
git add lib/invoice-totals.ts lib/__tests__/invoice-totals.test.ts src/app/api/v1/invoices/route.ts
git commit -m "refactor(invoices): extract calculateInvoiceTotals to shared lib"
```

---

## Task 3: Marketplace import input schema

**Files:**
- Modify: `src/types/api.ts`
- Test: `src/utils/__tests__/marketplaceImportSchema.test.ts` (or co-locate with types tests if a pattern exists)

- [ ] **Step 1: Write the failing test:**

```typescript
import { describe, it, expect } from 'vitest';
import { marketplaceImportInputSchema } from '../../types/api';

describe('marketplaceImportInputSchema', () => {
  it('accepts a valid order batch', () => {
    const r = marketplaceImportInputSchema.safeParse({
      orders: [{
        orderNo: 'A1', issueDate: '2026-06-03',
        lines: [{ itemId: 'i1', description: 'X', sku: 'CC211D', quantity: 1, unitPrice: 49304 }],
      }],
      options: { recordPayment: true },
    });
    expect(r.success).toBe(true);
  });
  it('rejects a line with no itemId (master-only rule)', () => {
    const r = marketplaceImportInputSchema.safeParse({
      orders: [{ orderNo: 'A1', issueDate: '2026-06-03', lines: [{ description: 'X', sku: 'S', quantity: 1, unitPrice: 1 }] }],
      options: { recordPayment: true },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`marketplaceImportInputSchema` undefined).

Run: `npx vitest run src/utils/__tests__/marketplaceImportSchema.test.ts`

- [ ] **Step 3: Add the schema to `src/types/api.ts`** (near the other invoice schemas; reuse `isoDateString`, `positiveDecimal`):

```typescript
export const marketplaceImportLineSchema = z.object({
  itemId: z.string().trim().min(1, 'Every line must map to a master item'),
  description: z.string().trim().min(1),
  sku: z.string().trim().default(''),
  quantity: positiveDecimal,
  unitPrice: positiveDecimal,
});

export const marketplaceImportOrderSchema = z.object({
  orderNo: z.string().trim().min(1),
  issueDate: isoDateString,
  lines: z.array(marketplaceImportLineSchema).min(1),
});

export const marketplaceImportInputSchema = z.object({
  orders: z.array(marketplaceImportOrderSchema).min(1),
  options: z.object({
    customerId: z.string().trim().optional(),
    recordPayment: z.boolean().default(true),
  }),
});
```

- [ ] **Step 4: Run it — PASS.** Run: `npx vitest run src/utils/__tests__/marketplaceImportSchema.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/utils/__tests__/marketplaceImportSchema.test.ts
git commit -m "feat(types): add marketplaceImportInputSchema (master-only lines)"
```

---

## Task 4: Import orchestrator (`lib/marketplace-import.ts`)

This is the accounting heart. Per order, in one transaction: idempotency → inactive guard → create+finalize invoice (with `allowNegativeStock: true`) → settlement receipt.

**Files:**
- Create: `lib/marketplace-import.ts`
- Test: `lib/__tests__/integration/marketplace-import.int.test.ts`

- [ ] **Step 1: Write the failing integration test.** Use the existing int-test harness conventions (look at `lib/__tests__/integration/import-opening-stock.int.test.ts` for setup/teardown helpers — org/customer/account/item seeding + a real `prisma`):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { importMarketplaceOrders } from '@/lib/marketplace-import';
// reuse the harness's seed helpers (org, customer, settlement bank acct, active item, inactive item)

describe('importMarketplaceOrders', () => {
  it('creates a posted, paid invoice with a settlement receipt and is balanced', async () => {
    const { orgId, userId, connectionId, customerId, itemId } = await seedActiveScenario();
    const res = await importMarketplaceOrders(orgId, userId, connectionId, [
      { orderNo: 'ORD1', issueDate: '2026-06-03', lines: [{ itemId, description: 'X', sku: 'S1', quantity: 1, unitPrice: 49304 }] },
    ], { recordPayment: true });
    expect(res.created).toBe(1);
    const inv = await prisma.salesInvoice.findFirst({ where: { organizationId: orgId, poNumber: 'ORD1' } });
    expect(inv?.status).toBe('PAID');
    // trial balance balanced
    const sums = await prisma.journalLine.aggregate({ where: { entry: { organizationId: orgId } }, _sum: { debit: true, credit: true } });
    expect(Number(sums._sum.debit)).toBeCloseTo(Number(sums._sum.credit), 2);
  });

  it('skips an already-imported order (idempotent by orderNo)', async () => {
    const { orgId, userId, connectionId, itemId } = await seedActiveScenario();
    const order = { orderNo: 'ORD1', issueDate: '2026-06-03', lines: [{ itemId, description: 'X', sku: 'S1', quantity: 1, unitPrice: 1000 }] };
    await importMarketplaceOrders(orgId, userId, connectionId, [order], { recordPayment: true });
    const res2 = await importMarketplaceOrders(orgId, userId, connectionId, [order], { recordPayment: true });
    expect(res2.created).toBe(0);
    expect(res2.skipped).toBe(1);
    expect(await prisma.salesInvoice.count({ where: { organizationId: orgId, poNumber: 'ORD1' } })).toBe(1);
  });

  it('rejects an order whose line maps to an inactive item; sibling order still imports', async () => {
    const { orgId, userId, connectionId, itemId, inactiveItemId } = await seedActiveScenario();
    const res = await importMarketplaceOrders(orgId, userId, connectionId, [
      { orderNo: 'BAD', issueDate: '2026-06-03', lines: [{ itemId: inactiveItemId, description: 'Y', sku: 'S2', quantity: 1, unitPrice: 1000 }] },
      { orderNo: 'GOOD', issueDate: '2026-06-03', lines: [{ itemId, description: 'X', sku: 'S1', quantity: 1, unitPrice: 1000 }] },
    ], { recordPayment: true });
    expect(res.created).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].orderNo).toBe('BAD');
    expect(await prisma.salesInvoice.findFirst({ where: { poNumber: 'BAD' } })).toBeNull();
  });

  it('posts a new-item sale at 0 stock without throwing (import-scoped negative stock)', async () => {
    const { orgId, userId, connectionId } = await seedActiveScenario();
    const zeroStockItem = await seedItem(orgId, { sku: 'NEW1', openingStock: 0, costPrice: 0 });
    const res = await importMarketplaceOrders(orgId, userId, connectionId, [
      { orderNo: 'ZS', issueDate: '2026-06-03', lines: [{ itemId: zeroStockItem.id, description: 'New', sku: 'NEW1', quantity: 3, unitPrice: 5000 }] },
    ], { recordPayment: true });
    expect(res.created).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (module missing).

Run: `npm run test:int -- marketplace-import`

- [ ] **Step 3: Implement `lib/marketplace-import.ts`:**

```typescript
import { prisma } from '@/lib/prisma';
import { calculateInvoiceTotals } from '@/lib/invoice-totals';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postArPaymentIfNeeded } from '@/lib/payment-posting';
import { generateInvoiceNumber } from '@/lib/invoice-totals'; // OR reuse the route's numbering helper — see note below
import { loadOrgAccountDefaults } from '@/lib/account-defaults';

export interface ImportOrderLine { itemId: string; description: string; sku: string; quantity: number; unitPrice: number; }
export interface ImportOrder { orderNo: string; issueDate: string; lines: ImportOrderLine[]; }
export interface ImportOptions { customerId?: string; recordPayment: boolean; }
export interface ImportResult { created: number; skipped: number; failed: Array<{ orderNo: string; reason: string }>; }

export async function importMarketplaceOrders(
  orgId: string,
  userId: string,
  connectionId: string,
  orders: ImportOrder[],
  options: ImportOptions,
): Promise<ImportResult> {
  const conn = await prisma.ecommerceConnection.findFirst({
    where: { id: connectionId, organizationId: orgId },
  });
  if (!conn) throw new Error('Connection not found');
  const customerId = options.customerId || conn.customerId;
  if (!customerId) throw new Error('No customer mapped for this store');

  const result: ImportResult = { created: 0, skipped: 0, failed: [] };

  for (const order of orders) {
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Idempotency
        const dupe = await tx.salesInvoice.findFirst({
          where: { organizationId: orgId, poNumber: order.orderNo, status: { not: 'VOID' } },
          select: { id: true },
        });
        if (dupe) { result.skipped += 1; return; }

        // 2. Inactive-product guard (whole order)
        const itemIds = [...new Set(order.lines.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, organizationId: orgId }, select: { id: true, isActive: true, name: true } });
        const inactive = items.find((i) => !i.isActive);
        if (inactive) throw new InactiveItemError(inactive.name);

        // 3. Create invoice (DRAFT) using shared totals
        const totals = calculateInvoiceTotals(
          {
            discountPct: 0,
            tax: { enabled: conn.taxInclusive ? true : true, rate: undefined, inclusive: conn.taxInclusive },
            lines: order.lines.map((l) => ({ itemId: l.itemId, description: l.description, code: l.sku, quantity: l.quantity, unit: 'PCS', price: l.unitPrice, discountPct: 0 })),
          },
          await orgTaxDefaults(tx, orgId),
        );
        const number = await generateInvoiceNumber(tx, orgId);
        const invoice = await tx.salesInvoice.create({
          data: {
            organizationId: orgId, createdById: userId, number, customerId,
            invoiceType: 'Sales Invoice', issueDate: new Date(order.issueDate), poNumber: order.orderNo,
            currency: 'IDR', status: 'DRAFT',
            discountPct: totals.discountPct, subtotal: totals.subtotal, discountAmount: totals.discountAmount,
            taxEnabled: totals.taxEnabled, taxInclusive: totals.taxInclusive, taxRate: totals.taxRate,
            taxAmount: totals.taxAmount, totalAmount: totals.totalAmount,
            lines: { create: totals.lines },
          },
          select: { id: true, totalAmount: true },
        });

        // 4. Finalize → SENT (posts revenue + COGS, import-scoped negative stock)
        await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });
        await postInvoiceSend(tx, orgId, invoice.id, { allowNegativeStock: true });

        // 5. Settlement receipt (Dr settlement / Cr AR), marks PAID
        if (options.recordPayment && conn.holdingAccountId) {
          const payNumber = await generateArPaymentNumber(tx, orgId);
          const payment = await tx.aRPayment.create({
            data: {
              organizationId: orgId, number: payNumber, customerId,
              date: new Date(order.issueDate), method: 'BANK_TRANSFER', status: 'COMPLETED',
              depositAccountId: conn.holdingAccountId, totalAmount: Number(invoice.totalAmount),
              allocations: { create: [{ invoiceId: invoice.id, amountApplied: Number(invoice.totalAmount) }] },
            },
            select: { id: true },
          });
          await postArPaymentIfNeeded(tx, orgId, payment.id);
          await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
        }

        result.created += 1;
      });
    } catch (e) {
      result.failed.push({ orderNo: order.orderNo, reason: e instanceof Error ? e.message : 'Import failed' });
    }
  }
  return result;
}

class InactiveItemError extends Error {
  constructor(itemName: string) { super(`Order contains an inactive product: ${itemName}`); this.name = 'InactiveItemError'; }
}
```

> **Numbering note (sub-step):** `generateInvoiceNumber` / `generateArPaymentNumber` must reuse the SAME sequence logic the existing routes use. Before implementing, grep how `number` is assigned in `src/app/api/v1/invoices/route.ts` and `src/app/api/v1/ar-payments/route.ts` (look for the helper that produces `number`), and either import that helper or extract it alongside this task. Do NOT invent a parallel numbering scheme. Likewise confirm the exact arg shape `calculateInvoiceTotals` expects for `tax` by reading `lib/invoice-totals.ts`; adjust the `tax` object above to match. `orgTaxDefaults(tx, orgId)` = read `organization` tax settings the same way the invoices route builds its `orgDefaults` (extract a tiny helper if needed).

- [ ] **Step 4: Run the integration tests — iterate to green.**

Run: `npm run test:int -- marketplace-import`
Expected: all 4 cases PASS. Fix seeding/arg-shape mismatches against the real harness as needed.

- [ ] **Step 5: Run the GL invariant integration suite to confirm balanced books.**

Run: `npm run test:int`
Expected: full int suite green (no trial-balance/subledger regressions).

- [ ] **Step 6: Commit**

```bash
git add lib/marketplace-import.ts lib/__tests__/integration/marketplace-import.int.test.ts
git commit -m "feat(import): marketplace import orchestrator (idempotent, inactive-guard, GL-posted)"
```

---

## Task 5: Import route `POST /api/v1/integrations/[id]/import`

**Files:**
- Create: `src/app/api/v1/integrations/[id]/import/route.ts`
- Test: `lib/__tests__/integration/marketplace-import-route.int.test.ts` (or extend Task 4's file if the harness can call route handlers)

- [ ] **Step 1: Write the failing test** — call the route handler with a mocked `NextRequest` carrying `x-org-id` / `x-user-id` headers and a JSON body; assert `200` + `{ created, skipped, failed }`. Mirror an existing route int-test (e.g. how `ar-payments` route tests build requests).

- [ ] **Step 2: Run it — FAIL** (route missing).

- [ ] **Step 3: Implement the route:**

```typescript
import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireAuth, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { marketplaceImportInputSchema } from '@/types/api';
import { importMarketplaceOrders } from '@/lib/marketplace-import';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withPermission({ module: 'AR_INVOICES', action: 'create' }, async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = requireAuth(req);
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = marketplaceImportInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid import payload', 400);
  const result = await importMarketplaceOrders(orgId, userId, id, parsed.data.orders, parsed.data.options);
  return ok(result, 200);
});
```

> Confirm the App-Router context param shape (`ctx.params` Promise vs object) against another `[id]` route in this repo, e.g. `src/app/api/v1/invoices/[id]/route.ts`, and match it exactly.

- [ ] **Step 4: Run it — PASS.** Run: `npm run test:int -- marketplace-import-route`

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/v1/integrations/[id]/import/route.ts" lib/__tests__/integration/marketplace-import-route.int.test.ts
git commit -m "feat(api): POST /integrations/[id]/import endpoint"
```

---

## Task 6: Platform format detection (②.2)

**Files:**
- Create: `src/utils/marketplaceFormat.ts`
- Modify: `src/utils/shopeeImport.ts` (sheet selection by platform)
- Test: `src/utils/__tests__/marketplaceFormat.test.ts`

- [ ] **Step 1: Write the failing unit test** using the real header signatures:

```typescript
import { describe, it, expect } from 'vitest';
import { detectPlatformFromHeaders } from '../marketplaceFormat';

describe('detectPlatformFromHeaders', () => {
  it('detects Shopee from its Indonesian headers', () => {
    expect(detectPlatformFromHeaders(['No. Pesanan','Status Pesanan','SKU Induk','Nama Produk','Nomor Referensi SKU','Jumlah'], 'Matched Orders')).toBe('Shopee');
  });
  it('detects TikTok from its English headers', () => {
    expect(detectPlatformFromHeaders(['Order ID','Order Status','Seller SKU','Product Name','Quantity'], 'Filtered Adjusted')).toBe('TikTok');
  });
  it('returns null for an unrecognized file', () => {
    expect(detectPlatformFromHeaders(['Foo','Bar'], 'Sheet1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.** Run: `npx vitest run src/utils/__tests__/marketplaceFormat.test.ts`

- [ ] **Step 3: Implement `src/utils/marketplaceFormat.ts`:**

```typescript
import { normalizeHeader } from './shopeeImport';

export interface PlatformSignature {
  platform: string;
  sheet?: string;                 // preferred sheet name (optional)
  required: string[];             // header columns that must all be present (normalized match)
}

export const PLATFORM_SIGNATURES: PlatformSignature[] = [
  { platform: 'Shopee', sheet: 'Matched Orders', required: ['No. Pesanan', 'SKU Induk', 'Nama Produk'] },
  { platform: 'TikTok', sheet: 'Filtered Adjusted', required: ['Order ID', 'Seller SKU', 'Product Name'] },
  // Tokopedia/Lazada/Blibli added later
];

export function detectPlatformFromHeaders(headers: string[], _sheetName?: string): string | null {
  const norm = new Set(headers.map(normalizeHeader));
  for (const sig of PLATFORM_SIGNATURES) {
    if (sig.required.every((h) => norm.has(normalizeHeader(h)))) return sig.platform;
  }
  return null;
}

export function preferredSheetFor(platform: string): string | undefined {
  return PLATFORM_SIGNATURES.find((s) => s.platform === platform)?.sheet;
}
```

- [ ] **Step 4: Run — PASS.** Run: `npx vitest run src/utils/__tests__/marketplaceFormat.test.ts`

- [ ] **Step 5: Harden `parseShopeeExcel` sheet selection.** In `src/utils/shopeeImport.ts`, replace the hardcoded `workbook.SheetNames[0]` with: prefer the platform's named sheet when present, else fall back to the first sheet. Add an optional `platform` arg:

```typescript
export async function parseShopeeExcel(file: File, importStatusFilter = 'Selesai', platform?: string): Promise<ShopeeParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const preferred = platform ? preferredSheetFor(platform) : undefined;
  const sheetName = (preferred && workbook.SheetNames.includes(preferred)) ? preferred : workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  // ...rest unchanged...
}
```

Add `import { preferredSheetFor } from './marketplaceFormat';` (guard against a circular import — `marketplaceFormat` imports only `normalizeHeader`; if the cycle is a problem, move `normalizeHeader` into a tiny `headerUtils.ts` both import).

- [ ] **Step 6: Run the parser tests + typecheck.**

Run: `npx vitest run src/utils/__tests__ && npx tsc --noEmit`
Expected: PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/marketplaceFormat.ts src/utils/__tests__/marketplaceFormat.test.ts src/utils/shopeeImport.ts
git commit -m "feat(import): platform format detection + sheet selection"
```

---

## Task 7: `useImportMarketplaceOrders` hook

**Files:**
- Modify: `src/hooks/useIntegrations.ts`

- [ ] **Step 1: Add the mutation** (mirrors the existing `useCreateEcommerceConnection` pattern):

```typescript
export interface MarketplaceImportPayload {
  orders: Array<{ orderNo: string; issueDate: string; lines: Array<{ itemId: string; description: string; sku: string; quantity: number; unitPrice: number }> }>;
  options: { customerId?: string; recordPayment: boolean };
}
export interface MarketplaceImportResult { created: number; skipped: number; failed: Array<{ orderNo: string; reason: string }>; }

export function useImportMarketplaceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, ...body }: MarketplaceImportPayload & { connectionId: string }) =>
      api.post<MarketplaceImportResult>(`/api/v1/integrations/${connectionId}/import`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['arPayments'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useIntegrations.ts
git commit -m "feat(hooks): useImportMarketplaceOrders mutation"
```

---

## Task 8: Wizard rewrite — detection, SKU cross-check, backend Confirm (②.3)

**Files:**
- Modify: `src/components/ar/invoices/ImportInvoicesModal.tsx`
- Uses: `useItems` (`src/hooks/useInventory.ts`), `useCreateItem`, `useCustomers` (`src/hooks/useAR.ts`), `useImportMarketplaceOrders`, `detectPlatformFromHeaders`.

This task is UI logic; verify it in the dev-server preview (see Verification at the end), not via a unit test.

- [ ] **Step 1: Upload step — detect + block wrong platform.** In `handleFileSelect`, after reading the workbook headers, detect the platform and compare to the selected store's `platform`. On mismatch, set `parseError` and stop. Read the workbook once to get headers for detection, then call `parseShopeeExcel(f, filter, shop.platform)`:

```typescript
import * as XLSX from 'xlsx';
import { detectPlatformFromHeaders } from '../../../utils/marketplaceFormat';
// ...
const buf = await f.arrayBuffer();
const wb = XLSX.read(buf, { type: 'array' });
const firstSheet = wb.Sheets[wb.SheetNames[0]];
const headerRow = (XLSX.utils.sheet_to_json(firstSheet, { header: 1 })[0] as string[]) || [];
const detected = detectPlatformFromHeaders(headerRow, wb.SheetNames[0]);
if (detected && shop && detected !== shop.platform) {
  setParseError(`This looks like a ${detected} export, but the selected store "${shop.name}" is ${shop.platform}. Upload the matching file.`);
  return;
}
```

- [ ] **Step 2: Mapping step — auto-match by SKU + flag inactive + bulk create.** Replace the manual-only mapping with: load `useItems()`, build a `Map<normalizedSku, item>`. For each `uniqueProduct`, auto-map when its SKU matches an **active** item; collect `unmatched` (no SKU match) and `inactiveBlocked` (SKU matches an inactive item) into separate lists. Render:
  - matched count,
  - an **"Create all N new items"** button (only when `unmatched.length > 0`),
  - a read-only **"Will be skipped (inactive product)"** list showing each blocked SKU + its order count.

```typescript
const { data: itemsData } = useItems();
const itemsBySku = useMemo(() => {
  const m = new Map<string, { id: string; isActive: boolean }>();
  (itemsData?.data ?? []).forEach((it: any) => { if (it.sku) m.set(normalizeHeader(it.sku), { id: it.id, isActive: it.isActive !== false }); });
  return m;
}, [itemsData]);

// classify
const { unmatched, inactiveBlocked } = useMemo(() => { /* iterate parseResult.uniqueProducts, look up itemsBySku by product SKU */ }, [parseResult, itemsBySku, localMappings]);
```

For **"Create all"**, loop the `unmatched` products calling `useCreateItem().mutateAsync` with `{ sku, name, type: 'PRODUCT', unit: 'PCS', sellingPrice: <order price>, costPrice: 0, openingStock: 0 }`, then set `localMappings[product.key] = created.id`. (Refetch items afterward.)

- [ ] **Step 3: Block Confirm.** Disable the Confirm/Import button while `unmatched.length > 0`. (Inactive-blocked products do NOT block — their orders are just excluded server-side and reported.)

- [ ] **Step 4: Confirm — call the backend, drop localStorage.** Replace `transformOrdersToInvoices(...)` + all `addInvoicesBatch/addPaymentsBatch/...` store writes with: build the `orders` payload from `parseResult.parsedOrders` (each line's `itemId` from `localMappings`, `unitPrice` = price-after-discount, `issueDate` from the order's date field) and call:

```typescript
const importMutation = useImportMarketplaceOrders();
// ...
const res = await importMutation.mutateAsync({
  connectionId: shopId,
  orders: ordersPayload,
  options: { customerId: shop.customer, recordPayment: true },
});
setImportResult(res);
setStep('done');
```

Remove the imports/usages of `useInvoiceStore`, `usePaymentStore`, `useInventoryStore`, `useCustomerStore` from this file.

- [ ] **Step 5: Done step — show created / skipped / failed.** Render `res.created` created, `res.skipped` skipped (already imported), and a list of `res.failed` (orderNo + reason) so the user sees exactly which orders did not upload.

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit` → 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ar/invoices/ImportInvoicesModal.tsx
git commit -m "feat(import): wizard detects format, cross-checks SKUs, posts to backend"
```

---

## Task 9: Import button placement beside "+ New Invoice"

**Files:**
- Modify: the workspace invoices area — `src/components/workspace/TwoLevelTabBar.tsx` (or `InvoiceListPane.tsx`), and confirm the standalone `InvoiceWorkbench.tsx` still exposes Import in its header.

- [ ] **Step 1:** Place the Import trigger next to the "+ New Invoice" document-tab affordance for the invoices module (open the `ImportInvoicesModal`). Keep RBAC gating (`canCreate`). Match the existing button styling.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(import): surface Import action beside New Invoice"
```

---

## Final Verification

- [ ] **Full unit suite:** `npm test` → green.
- [ ] **Full integration suite:** `npm run test:int` → green (balanced trial balance, no subledger/period-lock regressions).
- [ ] **Typecheck:** `npx tsc --noEmit` → 0 errors.
- [ ] **Manual (dev-server preview, workspace mode):** upload a real Shopee file into a Shopee store → preview → map (auto-match + create-all for new SKUs) → Confirm → done shows created/skipped/failed; the new invoices appear in the AR invoice list and the GL. Upload a TikTok file into a Shopee store → blocked with the mismatch message. Re-upload the same file → all orders reported skipped.

---

## Notes / explicitly deferred

- **②.4 fees/shipping** (the *Ongkir dan Fee* config consumption) — not in this build.
- **Refund/return** handling (the exports carry returned-quantity columns) — not in this build.
- **System-wide duplicate-button cleanup** — separate task (`task_e3b115c8`).
- **③ best-selling-products widget** — after this lands.
- Numbering helpers and the exact `calculateInvoiceTotals` `tax` arg shape must be confirmed against the real route code during Task 4 (flagged inline) — do not invent parallel logic.
