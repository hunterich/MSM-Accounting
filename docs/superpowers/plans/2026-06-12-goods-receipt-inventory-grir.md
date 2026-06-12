# Goods Receipt Inventory via GR/IR Clearing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize inventory and a GR/IR clearing liability when goods are physically received (not when the bill is finalized), valuing inventory at net cost across the non-PKP / VAT-exclusive / VAT-inclusive cases.

**Architecture:** Receiving posts `Dr Inventory / Cr GR/IR` + adds a cost layer at net unit cost. The bill (on DRAFT→OPEN or direct-OPEN create) posts `Dr GR/IR (+ Dr Input Tax) / Cr AP`, clearing GR/IR. A single shared `postBillToLedger` helper drives both bill-posting callers; a per-line rule routes received PO lines to GR/IR and everything else to today's behavior. Two new document flags (`taxable`, `taxInclusive`) mirror Accurate's "Kena Pajak" / "Total termasuk Pajak".

**Tech Stack:** Next.js App Router API routes, Prisma (PostgreSQL), Zod, React 19 + Vite, Vitest (fully-mocked Prisma).

**Reference spec:** `docs/superpowers/specs/2026-06-12-goods-receipt-inventory-grir-design.md`

**IMPORTANT — isolation:** A concurrent process is editing this working directory (an opening-balance feature touching `prisma/schema.prisma`, `lib/account-defaults.ts`, `lib/inventory-costing.ts`). Execute this plan in a dedicated git worktree (via `superpowers:using-git-worktrees`) so the two efforts don't clobber each other.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `prisma/schema.prisma` | `taxable` + `taxInclusive` on `PurchaseOrder` and `Bill` | Modify |
| `types/api.ts` | Zod: add the two flags + line `purchaseOrderLineId` | Modify |
| `lib/account-defaults.ts` | `grIrClearing` account-default spec | Modify |
| `lib/grir.ts` | `ensureGrIrAccount` (idempotent auto-create) | Create |
| `lib/bill-posting.ts` | `postBillToLedger` — shared bill GL/inventory posting | Create |
| `src/app/api/v1/bills/route.ts` | Use `postBillToLedger` on OPEN create | Modify |
| `src/app/api/v1/bills/[id]/route.ts` | Post on DRAFT→OPEN; preserve `purchaseOrderLineId` | Modify |
| `src/app/api/v1/purchase-orders/[id]/receive/route.ts` | Net cost layer + GR/IR journal; copy PO tax fields | Modify |
| `src/views/ap/POForm.tsx`, `BillForm.tsx` | Two "Info Pajak" checkboxes | Modify |
| `lib/__tests__/grir.test.ts`, `lib/__tests__/bill-posting.test.ts`, `src/app/api/v1/__tests__/receive-grir.test.ts` | Tests | Create |

**Shared helpers (already exist, do not redefine):**
- `addCostLayer(tx, orgId, itemId, warehouseId|null, qty, unitCost, docType, docId, date)` — `lib/inventory-costing.ts`
- `postJournalEntry(tx, { organizationId, date, memo, lines: [{accountId, description, debit, credit}] })` — `lib/journal-posting.ts`
- `toNumber(v)`, `asMoney(n)` — `lib/money.ts`
- `resolveAccountDefaultId(accounts, settings, key)`, `loadOrgAccountDefaults(tx, orgId)` — `lib/account-defaults.ts`
- `nextNumber(tx, 'Bill', 'number', 'BILL')` — `lib/api-utils.ts`
- `InventoryDocumentType.PURCHASE` — `@prisma/client`

---

## Net-cost convention (used by every posting task)

For a line with stored `lineTotal` (= `qty × price`) and document flags `taxable`, `taxInclusive`, `taxRate` (percent):

```ts
const rate = taxable ? toNumber(taxRate) / 100 : 0;          // 0 when non-PKP
const gross = toNumber(lineTotal);
const net   = taxInclusive ? asMoney(gross / (1 + rate)) : gross;
```

- **Inventory / GR/IR** are always posted at **`net`**.
- **Input tax** per line: `taxInclusive ? (gross - net) : asMoney(net * rate)` (0 when not taxable).
- **AP credit** = `Σ net (all lines) + Σ input tax` — computed from lines so the entry always balances. Any sub-rupiah delta vs the stored header total is immaterial (within `postJournalEntry`'s half-cent tolerance).

Receipt and bill both derive `net` from the same line `price/qty/rate`, so GR/IR clears to zero.

---

## Task 1: Schema — `taxable` + `taxInclusive` on PurchaseOrder and Bill

**Files:**
- Modify: `prisma/schema.prisma` (PurchaseOrder model near `taxRate`; Bill model near `taxRate`)

- [ ] **Step 1: Add the two columns to `PurchaseOrder`**

In `model PurchaseOrder`, immediately after the `taxRate` line, add:

```prisma
  taxable        Boolean             @default(false)
  taxInclusive   Boolean             @default(false)
```

- [ ] **Step 2: Add the two columns to `Bill`**

In `model Bill`, immediately after its `taxRate` line, add:

```prisma
  taxable        Boolean     @default(false)
  taxInclusive   Boolean     @default(false)
```

- [ ] **Step 3: Regenerate the Prisma client (NO database commands)**

This project syncs schema via `prisma db push`, not migrations (there is no
`prisma/migrations/` dir), and the dev DB is shared with a concurrent process.
**Do NOT run `prisma migrate dev`, `prisma db push`, or `prisma migrate reset`** —
they would clobber shared data. The mocked tests only need the generated client.

Run: `npx prisma generate`
Expected: client regenerates; `grep -c taxInclusive node_modules/.prisma/client/index.d.ts` is > 0.

(Applying the columns to the real DB via `npx prisma db push` is deferred to
integration/merge time, run once by whoever merges.)

- [ ] **Step 4: Verify client types**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "taxable|taxInclusive" || echo "no type errors for new fields"`
Expected: `no type errors for new fields`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(ap): add taxable/taxInclusive flags to PurchaseOrder and Bill"
```

---

## Task 2: Zod schemas — flags + line `purchaseOrderLineId`

**Files:**
- Modify: `types/api.ts` (`documentLineSchema` ~355; `billInputSchema` ~366; `updateBillInputSchema` ~382; `purchaseOrderInputSchema` ~445; `updatePurchaseOrderInputSchema` ~459)

- [ ] **Step 1: Add `purchaseOrderLineId` to `documentLineSchema`**

In `documentLineSchema`, after the `accountId` line, add:

```ts
  purchaseOrderLineId: z.string().trim().optional(),
```

- [ ] **Step 2: Add the two flags to all four header schemas**

In each of `billInputSchema`, `updateBillInputSchema`, `purchaseOrderInputSchema`, `updatePurchaseOrderInputSchema`, add these two lines next to the existing `taxRate` field:

```ts
  taxable: z.boolean().default(false),
  taxInclusive: z.boolean().default(false),
```

(For the two `update*` schemas, use `.optional()` instead of `.default(false)` to match their partial style:)

```ts
  taxable: z.boolean().optional(),
  taxInclusive: z.boolean().optional(),
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `0`

- [ ] **Step 4: Remove the `as any[]` cast in bills/route.ts (type now flows)**

In `src/app/api/v1/bills/route.ts`, change:

```ts
const linesWithPO = (parsed.data.lines as any[]).filter(l => l.purchaseOrderLineId);
```
to:
```ts
const linesWithPO = parsed.data.lines.filter(l => l.purchaseOrderLineId);
```

- [ ] **Step 5: Verify typecheck again, then commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `0`

```bash
git add types/api.ts src/app/api/v1/bills/route.ts
git commit -m "feat(ap): zod support for taxable/taxInclusive and line purchaseOrderLineId"
```

---

## Task 3: `grIrClearing` account-default spec

**Files:**
- Modify: `lib/account-defaults.ts` (inside `ACCOUNT_DEFAULT_SPECS`, after the `apControl` entry ~84)

- [ ] **Step 1: Add the spec entry**

After the `apControl` block, add:

```ts
  grIrClearing: {
    label: 'Goods Received Not Invoiced (GR/IR)',
    description: 'Clearing liability for goods received but not yet invoiced.',
    allowedTypes: ['Liability'],
    preferredCodes: ['2150', '215'],
    keywords: ['penerimaan barang belum tertagih', 'goods received not invoiced', 'grir', 'gr ir', 'uninvoiced receipts', 'akrual pembelian'],
  },
```

- [ ] **Step 2: Verify typecheck (the `satisfies` clause must still pass)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add lib/account-defaults.ts
git commit -m "feat(coa): add grIrClearing account-default role"
```

---

## Task 4: `ensureGrIrAccount` helper

**Files:**
- Create: `lib/grir.ts`
- Test: `lib/__tests__/grir.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ensureGrIrAccount } from '../grir';

function makeTx(existing: any[] = [], createdId = 'acc-new') {
  const created: any[] = [];
  return {
    organization: { findUnique: vi.fn(async () => ({ accountDefaults: null })) },
    account: {
      findMany: vi.fn(async () => existing),
      findFirst: vi.fn(async () => existing.find(a => a.code === '2150') ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: createdId, ...data }; created.push(row); return row; }),
    },
    _created: created,
  };
}

describe('ensureGrIrAccount', () => {
  it('creates a postable LIABILITY account (code 2150) when none exists', async () => {
    const tx = makeTx([]);
    const id = await ensureGrIrAccount(tx as any, 'org-a');
    expect(tx.account.create).toHaveBeenCalled();
    const arg = (tx.account.create as any).mock.calls[0][0].data;
    expect(arg.type).toBe('LIABILITY');
    expect(arg.normalSide).toBe('CREDIT');
    expect(arg.code).toBe('2150');
    expect(arg.isPostable).toBe(true);
    expect(id).toBe('acc-new');
  });

  it('reuses an existing GR/IR account by code instead of creating', async () => {
    const tx = makeTx([{ id: 'acc-existing', code: '2150', name: 'GR/IR', type: 'LIABILITY', isActive: true, isPostable: true }]);
    const id = await ensureGrIrAccount(tx as any, 'org-a');
    expect(tx.account.create).not.toHaveBeenCalled();
    expect(id).toBe('acc-existing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/grir.test.ts`
Expected: FAIL — cannot find module `../grir`.

- [ ] **Step 3: Implement `lib/grir.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { loadOrgAccountDefaults } from './account-defaults';

const GRIR_CODE = '2150';
const GRIR_NAME = 'Goods Received Not Invoiced';

/**
 * Resolve the org's GR/IR clearing account id, creating it if absent.
 * Resolution order: configured `grIrClearing` default → existing account by
 * code 2150 → create a postable LIABILITY account. Idempotent. Never falls
 * back to an arbitrary liability (which could be AP).
 */
export async function ensureGrIrAccount(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<string> {
  // 1. Explicitly configured default
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const configuredId = settings.grIrClearing;
  if (configuredId) {
    const configured = await tx.account.findFirst({
      where: { id: configuredId, organizationId: orgId, isActive: true, isPostable: true, type: 'LIABILITY' },
      select: { id: true },
    });
    if (configured) return configured.id;
  }

  // 2. Existing account by code
  const byCode = await tx.account.findFirst({
    where: { organizationId: orgId, code: GRIR_CODE },
    select: { id: true },
  });
  if (byCode) return byCode.id;

  // 3. Create it
  const created = await tx.account.create({
    data: {
      organizationId: orgId,
      code: GRIR_CODE,
      name: GRIR_NAME,
      type: 'LIABILITY',
      normalSide: 'CREDIT',
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  return created.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/grir.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/grir.ts lib/__tests__/grir.test.ts
git commit -m "feat(grir): ensureGrIrAccount idempotent helper"
```

---

## Task 5: `postBillToLedger` shared helper (core)

This is the heart of the change. It posts inventory cost layers and one balanced journal entry for a bill, applying the per-line GR/IR-vs-inventory rule and the net-cost convention.

**Files:**
- Create: `lib/bill-posting.ts`
- Test: `lib/__tests__/bill-posting.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { postBillToLedger } from '../bill-posting';

vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));

import { addCostLayer } from '../inventory-costing';
import { postJournalEntry } from '../journal-posting';

const ACCOUNTS = [
  { id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-ap', code: '21', name: 'Hutang Usaha', type: 'Liability', isActive: true, isPostable: true },
  { id: 'acc-tax', code: '121', name: 'PPN Masukan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-exp', code: '51', name: 'HPP', type: 'Expense', isActive: true, isPostable: true },
];

function makeTx() {
  return {
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO' })) },
    account: { findMany: vi.fn(async () => ACCOUNTS), findFirst: vi.fn(), create: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) }, // item-1 is inventory
  };
}

function bill(over: any = {}) {
  return {
    id: 'bill-1', number: 'BILL-0001', issueDate: new Date('2026-06-01'),
    apAccountId: null, taxable: false, taxInclusive: false, taxRate: 0,
    lines: [{ id: 'bl-1', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: 'pol-1' }],
    ...over,
  };
}

describe('postBillToLedger', () => {
  it('received PO inventory line → Dr GR/IR, no new cost layer', async () => {
    const tx = makeTx();
    await postBillToLedger(tx as any, 'org-a', bill());
    expect(addCostLayer).not.toHaveBeenCalled();
    const je = (postJournalEntry as any).mock.calls[0][1];
    const grir = je.lines.find((l: any) => l.accountId === 'acc-grir');
    expect(grir.debit).toBe(10000);
    const ap = je.lines.find((l: any) => l.accountId === 'acc-ap');
    expect(ap.credit).toBe(10000);
  });

  it('manual (no PO link) inventory line → Dr Inventory + cost layer', async () => {
    const tx = makeTx();
    const b = bill({ lines: [{ id: 'bl-1', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null }] });
    await postBillToLedger(tx as any, 'org-a', b);
    expect(addCostLayer).toHaveBeenCalledTimes(1);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-inv').debit).toBe(10000);
  });

  it('VAT-inclusive received line values GR/IR at net and adds input tax', async () => {
    const tx = makeTx();
    const b = bill({ taxable: true, taxInclusive: true, taxRate: 11 });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    const grir = je.lines.find((l: any) => l.accountId === 'acc-grir');
    const tax = je.lines.find((l: any) => l.accountId === 'acc-tax');
    const ap = je.lines.find((l: any) => l.accountId === 'acc-ap');
    expect(grir.debit).toBeCloseTo(9009.01, 1);   // 10000 / 1.11
    expect(tax.debit).toBeCloseTo(990.99, 1);      // 10000 - net
    expect(ap.credit).toBe(10000);                 // gross
    // balance
    const totDr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totCr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totDr - totCr)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/bill-posting.test.ts`
Expected: FAIL — cannot find module `../bill-posting`.

- [ ] **Step 3: Implement `lib/bill-posting.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { toNumber, asMoney } from './money';
import { addCostLayer } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { ensureGrIrAccount } from './grir';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';

type Tx = Prisma.TransactionClient;

interface PostableBillLine {
  id: string;
  itemId: string | null;
  quantity: unknown;
  price: unknown;
  lineTotal: unknown;
  purchaseOrderLineId: string | null;
}
interface PostableBill {
  id: string;
  number: string;
  issueDate: Date | string | null;
  apAccountId: string | null;
  taxable: boolean;
  taxInclusive: boolean;
  taxRate: unknown;
  lines: PostableBillLine[];
}

/**
 * Post inventory cost layers + one balanced journal entry for a bill.
 *
 * Per-line rules:
 *   - inventory line WITH purchaseOrderLineId → Dr GR/IR, no cost layer
 *     (inventory was already recognized at goods receipt)
 *   - inventory line WITHOUT PO link → Dr Inventory + cost layer
 *   - service / non-inventory line → Dr Expense
 * Plus Dr Input Tax (when taxable) and Cr AP (the balancing credit).
 * All inventory/GR/IR/expense debits use NET line value; AP credit is the
 * sum of debits so the entry always balances.
 */
export async function postBillToLedger(tx: Tx, orgId: string, bill: PostableBill): Promise<void> {
  const lines = bill.lines ?? [];
  if (lines.length === 0) return;

  // Identify which lines are inventory items (PRODUCT / RAW_MATERIAL)
  const itemIds = lines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } },
        select: { id: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const apAccountId = bill.apAccountId ?? resolveAccountDefaultId(accounts, settings, 'apControl');
  const inputTaxAccountId = resolveAccountDefaultId(accounts, settings, 'apTax');
  const expenseAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');

  const taxable = Boolean(bill.taxable);
  const taxInclusive = Boolean(bill.taxInclusive);
  const rate = taxable ? toNumber(bill.taxRate) / 100 : 0;
  const billDate = bill.issueDate ? new Date(bill.issueDate) : new Date();

  let grirNet = 0;       // received inventory lines (clears liability)
  let inventoryNet = 0;  // manual inventory lines (Dr Inventory + cost layer)
  let expenseNet = 0;    // service lines
  let taxTotal = 0;
  const manualInventoryLines: Array<{ itemId: string; qty: number; unitCost: number }> = [];

  for (const line of lines) {
    const gross = toNumber(line.lineTotal);
    const net = taxInclusive ? asMoney(gross / (1 + rate)) : gross;
    const lineTax = !taxable ? 0 : taxInclusive ? asMoney(gross - net) : asMoney(net * rate);
    taxTotal += lineTax;

    const isInventory = line.itemId != null && inventoryItemIds.has(line.itemId);
    if (isInventory && line.purchaseOrderLineId) {
      grirNet += net;
    } else if (isInventory) {
      inventoryNet += net;
      const qty = toNumber(line.quantity);
      if (qty > 0) manualInventoryLines.push({ itemId: line.itemId as string, qty, unitCost: asMoney(net / qty) });
    } else {
      expenseNet += net;
    }
  }

  grirNet = asMoney(grirNet);
  inventoryNet = asMoney(inventoryNet);
  expenseNet = asMoney(expenseNet);
  taxTotal = asMoney(taxTotal);
  const apTotal = asMoney(grirNet + inventoryNet + expenseNet + taxTotal);

  // Cost layers for manual (non-received) inventory lines only.
  for (const m of manualInventoryLines) {
    await addCostLayer(tx, orgId, m.itemId, null, m.qty, m.unitCost, InventoryDocumentType.PURCHASE, bill.id, billDate);
  }

  const journalLines: Array<{ accountId: string; description: string; debit: number; credit: number }> = [];
  if (grirNet > 0) {
    const grirAccountId = await ensureGrIrAccount(tx, orgId);
    journalLines.push({ accountId: grirAccountId, description: `GR/IR clearing - ${bill.number}`, debit: grirNet, credit: 0 });
  }
  if (inventoryNet > 0 && inventoryAccountId) {
    journalLines.push({ accountId: inventoryAccountId, description: `Inventory - ${bill.number}`, debit: inventoryNet, credit: 0 });
  }
  if (expenseNet > 0 && expenseAccountId) {
    journalLines.push({ accountId: expenseAccountId, description: `Expense - ${bill.number}`, debit: expenseNet, credit: 0 });
  }
  if (taxTotal > 0 && inputTaxAccountId) {
    journalLines.push({ accountId: inputTaxAccountId, description: `Input tax - ${bill.number}`, debit: taxTotal, credit: 0 });
  }
  if (apTotal > 0 && apAccountId) {
    journalLines.push({ accountId: apAccountId, description: `AP - ${bill.number}`, debit: 0, credit: apTotal });
  }

  const hasDebit = journalLines.some((l) => l.debit > 0);
  const hasCredit = journalLines.some((l) => l.credit > 0);
  if (hasDebit && hasCredit) {
    await postJournalEntry(tx, { organizationId: orgId, date: billDate, memo: `Bill: ${bill.number}`, lines: journalLines });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/bill-posting.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bill-posting.ts lib/__tests__/bill-posting.test.ts
git commit -m "feat(ap): postBillToLedger shared helper with GR/IR per-line rule"
```

---

## Task 6: Use `postBillToLedger` in `POST /bills`

Replace the long inline posting block with the shared helper (DRY). Behavior for manual non-PO inventory bills is unchanged; PO-linked received lines now route to GR/IR.

**Files:**
- Modify: `src/app/api/v1/bills/route.ts` (the block from `// Add cost layers when bill status...` ~125 to the end of the journal posting ~256)

- [ ] **Step 1: Add the import**

At the top with the other imports, add:

```ts
import { postBillToLedger } from '@/lib/bill-posting';
```

- [ ] **Step 2: Replace the inline posting block**

Delete the entire block starting at the comment `// Add cost layers when bill status is APPROVED or OPEN ...` through the closing of its `if`/journal logic (the code that builds `journalLines` and calls `postJournalEntry`), and replace with:

```ts
    // Post inventory + GL when the bill is created already finalized.
    const billStatus = parsed.data.status as string;
    if ((billStatus === 'APPROVED' || billStatus === 'OPEN') && createdBill) {
      await postBillToLedger(tx, orgId, createdBill as any);
    }
```

Remove now-unused imports if they are no longer referenced in this file (`addCostLayer`, `resolveAccountDefaultId`, `loadOrgAccountDefaults`, `asMoney`, `postJournalEntry`, `InventoryDocumentType`) — verify each with a search before deleting; keep `toNumber` only if still used.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `0`

- [ ] **Step 4: Run existing AP tests (must still pass)**

Run: `npx vitest run src/app/api/v1/__tests__/ap.validation.test.ts`
Expected: PASS (unchanged behavior — the valid-payload test creates a DRAFT bill, so posting is skipped).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/bills/route.ts
git commit -m "refactor(ap): POST /bills uses postBillToLedger"
```

---

## Task 7: Post on DRAFT→OPEN and preserve `purchaseOrderLineId`

Today the PUT route silently moves a draft bill to OPEN with no GL/inventory and drops the PO line link on rebuild. Fix both.

**Files:**
- Modify: `src/app/api/v1/bills/[id]/route.ts` (`PUT` handler, lines ~29-87)

- [ ] **Step 1: Preserve `purchaseOrderLineId` on the line rebuild**

In the `if (lines) { ... createMany(...) }` block, add `purchaseOrderLineId` to the mapped object:

```ts
        await tx.billLine.createMany({
          data: lines.map((l, idx: number) => ({
            billId: id,
            itemId: l.itemId || null,
            accountId: l.accountId || null,
            purchaseOrderLineId: l.purchaseOrderLineId || null,
            lineNo: l.lineNo ?? idx + 1,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            price: l.price,
            lineTotal: l.lineTotal ?? (Number(l.quantity) * Number(l.price)),
          })),
        });
```

- [ ] **Step 2: Post to the ledger on the DRAFT→OPEN transition**

Add the import at the top:

```ts
import { postBillToLedger } from '@/lib/bill-posting';
```

Inside the `$transaction`, after the `tx.bill.update(...)` header update and the line rebuild, before the final `return tx.bill.findFirst(...)`, add:

```ts
      // Recognize GL + inventory when the bill is finalized (DRAFT → OPEN).
      if (existing.status === 'DRAFT' && header.status === 'OPEN') {
        const finalized = await tx.bill.findFirst({
          where: { id, organizationId: orgId },
          include: { lines: true },
        });
        if (finalized) await postBillToLedger(tx, orgId, finalized as any);
      }
```

(`existing` already selects `status`; ensure the select includes it — it does: `select: { id: true, status: true }`.)

- [ ] **Step 3: Write the failing test**

Create `src/app/api/v1/__tests__/bill-open-posting.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { bill: {}, $transaction: vi.fn() } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/bill-posting', () => ({ postBillToLedger: vi.fn(async () => undefined) }));

import { prisma } from '@/lib/prisma';
import { postBillToLedger } from '@/lib/bill-posting';
import { PUT as putBill } from '../bills/[id]/route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/bills/bill-1', {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

it('posts to the ledger when a DRAFT bill transitions to OPEN', async () => {
  const tx = {
    bill: {
      findFirst: vi.fn()
        .mockResolvedValueOnce({ id: 'bill-1', status: 'DRAFT' })            // existing
        .mockResolvedValueOnce({ id: 'bill-1', lines: [] })                  // finalized (for posting)
        .mockResolvedValueOnce({ id: 'bill-1', status: 'OPEN', lines: [] }), // return value
      update: vi.fn(async () => ({})),
    },
    billLine: { deleteMany: vi.fn(), createMany: vi.fn() },
    vendor: { findFirst: vi.fn() },
    purchaseOrder: { findFirst: vi.fn() },
  };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await putBill(req({ status: 'OPEN' }), { params: Promise.resolve({ id: 'bill-1' }) });
  expect(res.status).toBe(200);
  expect(postBillToLedger).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/api/v1/__tests__/bill-open-posting.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` → `0`

```bash
git add src/app/api/v1/bills/[id]/route.ts src/app/api/v1/__tests__/bill-open-posting.test.ts
git commit -m "feat(ap): post GL/inventory on bill DRAFT->OPEN; preserve PO line link"
```

---

## Task 8: Receipt posts net cost layer + GR/IR journal; copies PO tax fields

**Files:**
- Modify: `src/app/api/v1/purchase-orders/[id]/receive/route.ts`
- Test: `src/app/api/v1/__tests__/receive-grir.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { purchaseOrder: { findFirst: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('@/lib/cors', () => ({ corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/api-utils', async (orig) => ({ ...(await orig<any>()), nextNumber: vi.fn(async () => 'BILL-0001') }));
vi.mock('@/lib/inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('@/lib/journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('@/lib/grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));
vi.mock('@/lib/account-defaults', async (orig) => ({ ...(await orig<any>()), loadOrgAccountDefaults: vi.fn(async () => ({})) }));

import { prisma } from '@/lib/prisma';
import { addCostLayer } from '@/lib/inventory-costing';
import { postJournalEntry } from '@/lib/journal-posting';
import { POST as receive } from '../purchase-orders/[id]/receive/route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/purchase-orders/po-1/receive', {
    method: 'POST',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

it('posts Dr Inventory / Cr GR/IR at net cost and a cost layer for an inventory line', async () => {
  vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
    id: 'po-1', number: 'PO-0001', vendorId: 'v-1', organizationId: 'org-a',
    status: 'APPROVED', taxRate: 0, taxable: false, taxInclusive: false,
    vendor: { id: 'v-1' },
    lines: [{ id: 'pol-1', quantity: 10, receivedQty: 0, price: 1000, itemId: 'item-1', description: 'Widget', unit: 'PCS' }],
  } as any);

  const tx = {
    purchaseOrderLine: { findUnique: vi.fn(async () => ({ id: 'pol-1', quantity: 10, receivedQty: 0, purchaseOrderId: 'po-1', description: 'Widget', price: 1000, unit: 'PCS', itemId: 'item-1' })), update: vi.fn() },
    bill: { create: vi.fn(async () => ({ id: 'bill-1', number: 'BILL-0001' })) },
    purchaseOrder: { update: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) },
    // Must include an inventory-asset account so resolveAccountDefaultId finds one;
    // otherwise inventoryAccountId is '' and the journal would be skipped.
    account: { findMany: vi.fn(async () => [{ id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true }]) },
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO', accountDefaults: null })) },
  };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await receive(req({ lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 10 }] }), { params: Promise.resolve({ id: 'po-1' }) });
  expect(res.status).toBe(201);
  expect(addCostLayer).toHaveBeenCalledTimes(1);
  expect((addCostLayer as any).mock.calls[0][5]).toBe(1000); // net unit cost
  const je = (postJournalEntry as any).mock.calls[0][1];
  expect(je.lines.find((l: any) => l.accountId === 'acc-grir').credit).toBe(10000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/v1/__tests__/receive-grir.test.ts`
Expected: FAIL — receipt does not yet call `addCostLayer` / `postJournalEntry`.

- [ ] **Step 3: Copy PO tax fields onto the draft bill**

In the `tx.bill.create({ data: {...} })` call, replace the hardcoded tax fields. Change:

```ts
        taxRate: Number(po.taxRate),
        ...
        taxAmount: 0,
        totalAmount: billLinesData.reduce((s, l) => s + l.lineTotal, 0),
```
so the bill carries the PO's tax treatment and a correctly computed tax. Add near the top of the handler (after `po` is loaded):

```ts
  const rate = po.taxable ? Number(po.taxRate) / 100 : 0;
```

Then in the bill `data`, set:

```ts
        taxRate: Number(po.taxRate),
        taxable: po.taxable,
        taxInclusive: po.taxInclusive,
```
and compute subtotal/tax/total from `billLinesData` using the net convention. Replace the `subtotal`/`taxAmount`/`totalAmount` fields with:

```ts
        subtotal: asMoney(billLinesData.reduce((s, l) => s + (po.taxInclusive ? l.lineTotal / (1 + rate) : l.lineTotal), 0)),
        taxAmount: asMoney(billLinesData.reduce((s, l) => {
          const net = po.taxInclusive ? l.lineTotal / (1 + rate) : l.lineTotal;
          return s + (!po.taxable ? 0 : po.taxInclusive ? (l.lineTotal - net) : net * rate);
        }, 0)),
        totalAmount: asMoney(billLinesData.reduce((s, l) => {
          const net = po.taxInclusive ? l.lineTotal / (1 + rate) : l.lineTotal;
          const tax = !po.taxable ? 0 : po.taxInclusive ? (l.lineTotal - net) : net * rate;
          return s + (po.taxInclusive ? l.lineTotal : net + tax);
        }, 0)),
```

Add the imports at the top:

```ts
import { InventoryDocumentType } from '@prisma/client';
import { asMoney, toNumber } from '@/lib/money';
import { addCostLayer } from '@/lib/inventory-costing';
import { postJournalEntry } from '@/lib/journal-posting';
import { ensureGrIrAccount } from '@/lib/grir';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
```

- [ ] **Step 4: Post inventory cost layers + GR/IR journal inside the transaction**

After the PO status update (after the `tx.purchaseOrder.update(...)` near the end of the `$transaction` callback), and before `return created;`, add:

```ts
    // --- Inventory + GR/IR at receipt (net cost) ---
    const recvItemIds = billLinesData.map((l) => l.itemId).filter((x): x is string => Boolean(x));
    const invItems = recvItemIds.length
      ? await tx.item.findMany({ where: { id: { in: recvItemIds }, organizationId: orgId, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } }, select: { id: true } })
      : [];
    const invItemIds = new Set(invItems.map((i) => i.id));
    const receiptDate = new Date();
    let grirNet = 0;
    for (const l of billLinesData) {
      if (!l.itemId || !invItemIds.has(l.itemId)) continue;
      const qty = toNumber(l.quantity);
      if (qty <= 0) continue;
      const net = po.taxInclusive ? asMoney(l.lineTotal / (1 + rate)) : l.lineTotal;
      grirNet += net;
      await addCostLayer(tx, orgId, l.itemId, null, qty, asMoney(net / qty), InventoryDocumentType.PURCHASE, created.id, receiptDate);
    }
    grirNet = asMoney(grirNet);
    if (grirNet > 0) {
      const accounts = await tx.account.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true } });
      const settings = await loadOrgAccountDefaults(tx, orgId);
      const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
      const grirAccountId = await ensureGrIrAccount(tx, orgId);
      if (inventoryAccountId) {
        await postJournalEntry(tx, {
          organizationId: orgId,
          date: receiptDate,
          memo: `Goods receipt: PO ${po.number}`,
          lines: [
            { accountId: inventoryAccountId, description: `Inventory - PO ${po.number}`, debit: grirNet, credit: 0 },
            { accountId: grirAccountId, description: `GR/IR clearing - PO ${po.number}`, debit: 0, credit: grirNet },
          ],
        });
      }
    }
```

(Note: `created` is the bill returned from `tx.bill.create`; it is in scope at this point. The `requireOrg`-derived `orgId` is already defined at the top of the handler.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/api/v1/__tests__/receive-grir.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` → `0`

```bash
git add src/app/api/v1/purchase-orders/[id]/receive/route.ts src/app/api/v1/__tests__/receive-grir.test.ts
git commit -m "feat(ap): goods receipt posts net cost layer + GR/IR journal"
```

---

## Task 9: "Info Pajak" checkboxes in POForm and BillForm

Add `taxable` (Kena Pajak) and `taxInclusive` (Total termasuk Pajak) to the forms' tax state and submit payloads, defaulting from the vendor/org. (UI step — no unit test; verified via typecheck + preview.)

**Files:**
- Modify: `src/views/ap/POForm.tsx` (tax state ~160; payload ~235)
- Modify: `src/views/ap/BillForm.tsx` (tax state ~151; checkbox block ~615; payload ~278)

- [ ] **Step 1: POForm — extend tax state**

Change the `taxSettings` initializer to include the two flags (default `taxable` on when tax is enabled; `taxInclusive` from the org default):

```ts
const [taxSettings, setTaxSettings] = useState({
  enabled: globalTaxSettings.enabled,
  inclusive: globalTaxSettings.inclusiveByDefault,
  rate: globalTaxSettings.defaultRate,
  taxable: globalTaxSettings.enabled,
  taxInclusive: globalTaxSettings.inclusiveByDefault,
});
```

- [ ] **Step 2: POForm — render the two checkboxes**

Near the existing tax UI (where `taxSettings.enabled` is toggled), add:

```tsx
<label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
  <input type="checkbox" checked={taxSettings.taxable}
    onChange={(e) => setTaxSettings(p => ({ ...p, taxable: e.target.checked }))}
    className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
  Kena Pajak (taxable)
</label>
<label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
  <input type="checkbox" checked={taxSettings.taxInclusive}
    onChange={(e) => setTaxSettings(p => ({ ...p, taxInclusive: e.target.checked }))}
    className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
  Total termasuk Pajak (tax inclusive)
</label>
```

- [ ] **Step 3: POForm — include flags in payload**

In the `finalPO` object, add after `taxRate`:

```ts
  taxable: taxSettings.taxable,
  taxInclusive: taxSettings.taxInclusive,
```

- [ ] **Step 4: BillForm — same three edits**

Apply Steps 1-3 to `BillForm.tsx`: extend its `taxSettings` initializer identically, add the same two `<label>` checkboxes next to the existing "Include default global Tax" checkbox (~615), and add `taxable`/`taxInclusive` to the `finalBill` payload (after its `taxRate` line ~286).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` → `0`

```bash
git add src/views/ap/POForm.tsx src/views/ap/BillForm.tsx
git commit -m "feat(ap): Kena Pajak / Total termasuk Pajak checkboxes on PO and Bill forms"
```

---

## Task 10: End-to-end VAT-case test (receipt + bill nets to zero)

A focused integration test asserting GR/IR clears across the three VAT treatments using the helpers directly (no DB).

**Files:**
- Test: `lib/__tests__/grir-roundtrip.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));

import { postJournalEntry } from '../journal-posting';
import { postBillToLedger } from '../bill-posting';

const ACCOUNTS = [
  { id: 'acc-inv', code: '131', name: 'Inv', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-ap', code: '21', name: 'AP', type: 'Liability', isActive: true, isPostable: true },
  { id: 'acc-tax', code: '121', name: 'PPN-In', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-exp', code: '51', name: 'HPP', type: 'Expense', isActive: true, isPostable: true },
];
const tx = () => ({
  organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO' })) },
  account: { findMany: vi.fn(async () => ACCOUNTS), findFirst: vi.fn(), create: vi.fn() },
  item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) },
});
const billFor = (flags: any) => ({
  id: 'b', number: 'BILL-0001', issueDate: new Date('2026-06-01'), apAccountId: null, ...flags,
  lines: [{ id: 'l', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: 'pol-1' }],
});

describe('GR/IR roundtrip — each VAT case the bill GR/IR debit equals the receipt net credit (10000/1.11 etc.)', () => {
  it.each([
    ['non-PKP', { taxable: false, taxInclusive: false, taxRate: 0 }, 10000],
    ['exclusive', { taxable: true, taxInclusive: false, taxRate: 11 }, 10000],
    ['inclusive', { taxable: true, taxInclusive: true, taxRate: 11 }, 9009.01],
  ])('%s', async (_name, flags, expectedNet) => {
    vi.clearAllMocks();
    await postBillToLedger(tx() as any, 'org-a', billFor(flags));
    const je = (postJournalEntry as any).mock.calls[0][1];
    const grir = je.lines.find((l: any) => l.accountId === 'acc-grir');
    expect(grir.debit).toBeCloseTo(expectedNet, 1);
    const dr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const cr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run lib/__tests__/grir-roundtrip.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 3: Run the whole suite**

Run: `npx vitest run`
Expected: all tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add lib/__tests__/grir-roundtrip.test.ts
git commit -m "test(ap): GR/IR clears to zero across non-PKP / exclusive / inclusive"
```

---

## Verification checklist (run after Task 10)

- [ ] `npx vitest run` — full suite green.
- [ ] `npx tsc --noEmit -p tsconfig.json` — 0 errors.
- [ ] Manual preview smoke (optional): create a PO with Kena Pajak off, receive it, confirm a draft bill + GR/IR journal; mark the bill Unpaid, confirm GR/IR clears and AP is credited.

## Notes for the executor

- Run in an isolated worktree (concurrent process edits `schema.prisma`, `account-defaults.ts`, `inventory-costing.ts`).
- The migration (Task 1) requires a reachable dev Postgres; `scripts/dev-setup.sh` bootstraps it.
- Do not re-add inventory cost layers in the bill path for PO-linked lines — that is the double-count the GR/IR rule prevents.
- Account `type` enum is UPPERCASE (`'LIABILITY'`), `normalSide` is `'CREDIT'`.
