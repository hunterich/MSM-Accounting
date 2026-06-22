# Stock-adjustment cost-layer sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stock adjustments write/relieve `InventoryLot` cost layers so the (lot-driven) Stock Valuation report stays in sync with the inventory ledger and GL — `lots = ledger = GL` under FIFO.

**Architecture:** Extract the cost-layer relief logic out of `calculateAndPostCOGS` into a reusable `relieveCostLayers` (behavior-preserving for sales). Rewrite `postStockAdjustmentToLedger` to drive both lots and the ledger through the shared helpers (`addCostLayer` on increase, `relieveCostLayers` on decrease) and net the GL from those lot-derived values, so the three views can't diverge.

**Tech Stack:** TypeScript, Prisma (Postgres), Vitest integration harness (`npm run test:int`, real `*_test` database).

**Spec:** `docs/superpowers/specs/2026-06-20-stock-adjustment-lot-sync-design.md`
**Branch:** `feat/stock-adjustment-lot-sync` (spec already committed here).

**One-time setup before running any integration test:** `npm run test:int:setup` (creates/sync `<db>_test`). Already run once; safe to re-run.

---

## File Structure

| File | Change |
|---|---|
| `lib/inventory-costing.ts` | Extract `relieveCostLayers` (FIFO/WA relief + ledger write, no stock guard); `calculateAndPostCOGS` becomes `assertSufficientStock` + `relieveCostLayers`. Pure refactor. |
| `lib/stock-adjustment-posting.ts` | Rewrite `postStockAdjustmentToLedger`: per-line `addCostLayer`/`relieveCostLayers`, GL nets lot-derived values. Update the docstring. |
| `lib/__tests__/integration/stock-adjustment-invariants.int.test.ts` | Rewrite scenarios to seed cost layers and assert `lots = ledger = GL`; remove the FIFO `it.fails`; add FIFO-mixed-cost, weighted-average, no-layer-decrease cases, and a WA-divergence `it.fails` pin. |

---

## Task 1: Extract `relieveCostLayers` (behavior-preserving refactor)

**Files:**
- Modify: `lib/inventory-costing.ts` (replace `calculateAndPostCOGS`, currently lines 294-365)

- [ ] **Step 1: Replace `calculateAndPostCOGS` with the extracted pair**

In `lib/inventory-costing.ts`, replace the entire existing `calculateAndPostCOGS` function (from its doc-comment at line ~285 through its closing brace at line 365) with these two functions:

```ts
/**
 * Relieve cost layers for an outbound movement using the org's costing method
 * (FIFO oldest-first, or weighted-average), write the outbound InventoryLedgerEntry,
 * and return the total cost removed.
 *
 * NOTE: this does NOT guard against insufficient stock — callers that need the
 * oversell guard (sales) run assertSufficientStock first via calculateAndPostCOGS.
 * Callers that are corrections (stock adjustments) relieve what exists and value
 * any shortfall at item.costPrice (consumeFIFO's fallback).
 */
export async function relieveCostLayers(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date
): Promise<number> {
  const method = await getOrgCostingMethod(tx, orgId)

  let totalCost: number
  let unitCost: number

  if (method === 'FIFO') {
    const result = await consumeFIFO(tx, orgId, itemId, warehouseId, qty, docType, docId, date)
    totalCost = result.totalCost
    unitCost = result.cogsPerUnit
  } else {
    // WEIGHTED_AVERAGE
    unitCost = await getWeightedAverageCost(tx, orgId, itemId, warehouseId)
    totalCost = asMoney(qty * unitCost)

    // Decrement lot balances oldest-first (for qty tracking only, cost is WA)
    const lots = await tx.inventoryLot.findMany({
      where: {
        organizationId: orgId,
        itemId,
        ...(warehouseId ? { warehouseId } : {}),
        qtyBalance: { gt: 0 },
      },
      orderBy: { date: 'asc' },
    })

    let remaining = qty
    for (const lot of lots) {
      if (remaining <= 0) break
      const lotBalance = toNumber(lot.qtyBalance)
      const consume = Math.min(lotBalance, remaining)
      remaining -= consume

      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          qtyOut: { increment: consume },
          qtyBalance: { decrement: consume },
        },
      })
    }
  }

  // Record outbound ledger entry
  await tx.inventoryLedgerEntry.create({
    data: {
      organizationId: orgId,
      itemId,
      warehouseId: warehouseId ?? null,
      date,
      documentType: docType,
      documentId: docId,
      qtyIn: 0,
      qtyOut: qty,
      unitCost,
      valueChange: asMoney(-totalCost),
    },
  })

  return totalCost
}

/**
 * High-level function: calculate and post COGS using the organisation's costing
 * method.  Returns the total COGS amount.  Guards against overselling, then
 * relieves cost layers via relieveCostLayers.
 */
export async function calculateAndPostCOGS(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date
): Promise<number> {
  await assertSufficientStock(tx, orgId, itemId, warehouseId, qty)
  return relieveCostLayers(tx, orgId, itemId, warehouseId, qty, docType, docId, date)
}
```

This is a straight cut/paste: `relieveCostLayers` is exactly the old `calculateAndPostCOGS` body *after* the `assertSufficientStock` call; `calculateAndPostCOGS` keeps the guard then delegates. No behavior change.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the sales/COGS path is unchanged**

Run: `npm run test:int`
Expected: same as baseline — `gl-invariants` all pass, `stock-adjustment-invariants` shows 4 passed + 1 expected fail (the adjustment code is untouched in this task). No regressions.

- [ ] **Step 4: Commit**

```bash
git add lib/inventory-costing.ts
git commit -m "refactor(inventory): extract relieveCostLayers from calculateAndPostCOGS"
```

---

## Task 2: Rewrite the adjustment posting to sync lots (TDD)

**Files:**
- Modify: `lib/__tests__/integration/stock-adjustment-invariants.int.test.ts` (full rewrite below)
- Modify: `lib/stock-adjustment-posting.ts`

- [ ] **Step 1: Rewrite the integration test to the new behavior**

Replace the **entire contents** of `lib/__tests__/integration/stock-adjustment-invariants.int.test.ts` with:

```ts
/**
 * GL invariants for the STOCK ADJUSTMENT posting path
 * (lib/stock-adjustment-posting.ts), run against the real test database.
 *
 * Adjustments now write/relieve InventoryLot cost layers, so lot valuation stays
 * in sync with the ledger and GL (FIFO). Under weighted-average the lot-sum
 * diverges from the ledger by a pre-existing model issue (layers keep original
 * costs; WA values consumption at the blended rate) — pinned with it.fails.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { postBillToLedger } from '../../bill-posting';
import {
  prisma,
  createTestOrg,
  createVendor,
  createItem,
  assertTrialBalanced,
  accountBalance,
  inventoryLedgerValue,
  inventoryLotValue,
  journalEntryCount,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-03-20T00:00:00.000Z');
const DATE_A = new Date('2026-03-18T00:00:00.000Z'); // older FIFO layer
const DATE_B = new Date('2026-03-19T00:00:00.000Z'); // newer FIFO layer

let adjSeq = 0;
async function postAdjustment(
  org: TestOrg,
  lines: Array<{ itemId: string; oldQty: number; newQty: number; unitCost: number }>,
) {
  adjSeq += 1;
  await prisma.$transaction((tx) =>
    postStockAdjustmentToLedger(tx, org.orgId, {
      id: `adj-${adjSeq}`,
      number: `ADJ-${adjSeq}`,
      date: DATE,
      warehouseId: null,
      lines,
    }),
  );
}

let rcvSeq = 0;
/** Receive `qty` @ `unitCost` via a manual-inventory bill (creates a cost layer). */
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number, date: Date = DATE) {
  rcvSeq += 1;
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-${rcvSeq}`, vendorId, issueDate: date, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) =>
    postBillToLedger(tx, org.orgId, {
      id: bill.id,
      number: bill.number,
      issueDate: date,
      apAccountId: null,
      taxable: false,
      taxInclusive: false,
      taxRate: 0,
      lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
    }),
  );
}

async function setWeightedAverage(orgId: string) {
  await prisma.organization.update({ where: { id: orgId }, data: { costingMethod: 'WEIGHTED_AVERAGE' } });
}

describe('GL invariant: stock adjustment direction + lot reconciliation', () => {
  it('an increase debits Inventory, credits Variance, and reconciles lots/ledger/GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await postAdjustment(org, [{ itemId, oldQty: 0, newQty: 10, unitCost: 1000 }]);

    await assertTrialBalanced(org.orgId, 'adjustment increase');
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(10000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(-10000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(10000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(10000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a FIFO decrease relieves layers at carrying cost and reconciles lots/ledger/GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 10, 1000); // lots/ledger/GL = 10000
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 4, unitCost: 1000 }]); // -6 @ 1000 = -6000

    await assertTrialBalanced(org.orgId, 'adjustment decrease');
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(4000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(6000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(4000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(4000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a net-zero batch writes lot/ledger rows but posts no adjustment journal entry', async () => {
    const org = await createTestOrg();
    const itemA = await createItem(org.orgId);
    const itemB = await createItem(org.orgId);

    await receiveStock(org, itemB, 5, 1000); // itemB has 5 @ 1000 to relieve
    const jeBefore = await journalEntryCount(org.orgId);

    // +5 @ 1000 (new layer) and -5 @ 1000 (relieve itemB) => net 0
    await postAdjustment(org, [
      { itemId: itemA, oldQty: 0, newQty: 5, unitCost: 1000 },
      { itemId: itemB, oldQty: 5, newQty: 0, unitCost: 1000 },
    ]);

    expect((await journalEntryCount(org.orgId)) - jeBefore).toBe(0); // adjustment posted no JE
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(5000, 2); // itemA 5000, itemB net 0
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(5000, 2);
    await assertTrialBalanced(org.orgId, 'net-zero batch');

    await cleanupOrg(org.orgId);
  });

  it('after a receipt + increase adjustment, lots, ledger, and GL all reconcile', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 10, 1000); // 10000
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 15, unitCost: 1000 }]); // +5 @ 1000

    await assertTrialBalanced(org.orgId, 'receipt + adjustment');
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(15000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(15000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(15000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a FIFO decrease consumes the oldest layer first at its actual cost (typed cost ignored)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 5, 1000, DATE_A); // older layer
    await receiveStock(org, itemId, 5, 1200, DATE_B); // newer layer
    // decrease 6 => 5 @ 1000 + 1 @ 1200 = 6200 (typed cost 9999 must be ignored)
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 4, unitCost: 9999 }]);

    await assertTrialBalanced(org.orgId, 'fifo mixed');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(6200, 2);
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(4800, 2); // 11000 - 6200
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(4800, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(4800, 2); // remaining 4 @ 1200

    await cleanupOrg(org.orgId);
  });

  it('a decrease with no cost layers does not throw (correction tool)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    // No receipt — zero layers. A decrease must not throw.
    await postAdjustment(org, [{ itemId, oldQty: 3, newQty: 0, unitCost: 500 }]);
    await assertTrialBalanced(org.orgId, 'no-layer decrease');

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: weighted-average adjustment', () => {
  it('a WA decrease posts the blended cost to ledger and GL', async () => {
    const org = await createTestOrg();
    await setWeightedAverage(org.orgId);
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 5, 1000, DATE_A);
    await receiveStock(org, itemId, 5, 1200, DATE_B); // WA = 1100
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 6, unitCost: 9999 }]); // -4 @ 1100 = 4400

    await assertTrialBalanced(org.orgId, 'WA decrease');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAdjustment)).toBeCloseTo(4400, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(6600, 2); // 11000 - 4400
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(6600, 2);

    await cleanupOrg(org.orgId);
  });

  // KNOWN PRE-EXISTING WA divergence: lot-sum keeps original per-layer costs while
  // WA values consumption at the blended rate, so lots != ledger under WA. This is
  // not specific to adjustments (sales COGS has it too). Flip to passing when the
  // WA cost-layer model is fixed (collapse to a single blended layer).
  it.fails('under WA, lot value should reconcile with the ledger (pre-existing divergence)', async () => {
    const org = await createTestOrg();
    await setWeightedAverage(org.orgId);
    const itemId = await createItem(org.orgId);

    await receiveStock(org, itemId, 5, 1000, DATE_A);
    await receiveStock(org, itemId, 5, 1200, DATE_B);
    await postAdjustment(org, [{ itemId, oldQty: 10, newQty: 6, unitCost: 9999 }]);

    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(await inventoryLedgerValue(org.orgId), 2);

    await cleanupOrg(org.orgId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:int -- stock-adjustment`
Expected: FAIL — several of the new `inventoryLotValue` assertions fail because the current `postStockAdjustmentToLedger` never touches lots (e.g. the increase test expects lots = 10000 but gets 0). (The two WA tests may already pass/expected-fail; the FIFO reconciliation tests must be failing.)

- [ ] **Step 3: Rewrite `postStockAdjustmentToLedger`**

In `lib/stock-adjustment-posting.ts`:

(a) Update the imports block at the top to add the costing helpers:
```ts
import { addCostLayer, relieveCostLayers } from './inventory-costing';
```
(Keep all existing imports: `Prisma` type, `InventoryDocumentType`, `asMoney`/`toNumber`, `postJournalEntry`, `resolveAccountDefaultId`/`loadOrgAccountDefaults`.)

(b) Replace the docstring above `postStockAdjustmentToLedger` (the block that currently says it "deliberately does NOT touch InventoryLot…") with:
```ts
/**
 * Post the inventory ledger + cost layers + balancing journal entry for a stock
 * adjustment. Each line drives the shared cost-layer helpers so lots and the
 * ledger move together:
 *   - increase (qtyDiff > 0): addCostLayer at the typed unit cost (new layer + ledger row).
 *   - decrease (qtyDiff < 0): relieveCostLayers at carrying cost (FIFO/WA) + ledger row.
 * The single net journal entry is posted from those lot-derived values, so
 * lots = ledger = GL by construction (FIFO; see the WA note in the integration tests).
 * Adjustments are never blocked on insufficient layers — a shortfall is valued at
 * item.costPrice (consumeFIFO's fallback).
 */
```

(c) Replace the **body** of `postStockAdjustmentToLedger` (everything from `const lines = args.lines ?? [];` through the function's closing brace — i.e. the old `inventoryLedgerEntry.createMany` block, the `netValueChange`/`netRounded` typed-cost computation, and the GL block) with:
```ts
  const lines = args.lines ?? [];
  if (lines.length === 0) return;

  let netValue = 0;
  for (const l of lines) {
    const qtyDiff = lineQtyDiff(l);
    if (qtyDiff > 0) {
      const unitCost = toNumber(l.unitCost);
      await addCostLayer(
        tx, orgId, l.itemId, args.warehouseId ?? null,
        qtyDiff, unitCost, InventoryDocumentType.ADJUSTMENT, args.id, args.date,
      );
      netValue += asMoney(qtyDiff * unitCost);
    } else if (qtyDiff < 0) {
      const cost = await relieveCostLayers(
        tx, orgId, l.itemId, args.warehouseId ?? null,
        -qtyDiff, InventoryDocumentType.ADJUSTMENT, args.id, args.date,
      );
      netValue -= cost;
    }
    // qtyDiff === 0 → no movement
  }

  const netRounded = asMoney(netValue);
  if (Math.abs(netRounded) === 0) return;

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const varianceAccountId =
    resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') ||
    resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  if (!inventoryAccountId || !varianceAccountId) return;

  const memo = `Stock adjustment: ${args.number}`;
  if (netRounded > 0) {
    await postJournalEntry(tx, {
      organizationId: orgId,
      date: args.date,
      memo,
      lines: [
        { accountId: inventoryAccountId, description: `Inventory increase - ${args.number}`, debit: netRounded, credit: 0 },
        { accountId: varianceAccountId,  description: `Stock variance - ${args.number}`,    debit: 0,           credit: netRounded },
      ],
    });
  } else {
    const amount = -netRounded;
    await postJournalEntry(tx, {
      organizationId: orgId,
      date: args.date,
      memo,
      lines: [
        { accountId: varianceAccountId,  description: `Stock variance - ${args.number}`,    debit: amount, credit: 0 },
        { accountId: inventoryAccountId, description: `Inventory decrease - ${args.number}`, debit: 0,     credit: amount },
      ],
    });
  }
```

Leave the `StockAdjustmentPostingLine`/`StockAdjustmentPostingArgs` interfaces and the `lineQtyDiff` helper unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:int -- stock-adjustment`
Expected: PASS — all FIFO reconciliation tests + the WA cost test pass; the WA-divergence `it.fails` is reported as **1 expected fail**. (e.g. `7 passed | 1 expected fail`.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/stock-adjustment-posting.ts lib/__tests__/integration/stock-adjustment-invariants.int.test.ts
git commit -m "feat(inventory): sync cost layers on stock adjustments (lots = ledger = GL, FIFO)"
```

---

## Task 3: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full integration suite**

Run: `npm run test:int`
Expected: `gl-invariants` all pass (sales/COGS unchanged), `stock-adjustment-invariants` pass with exactly **one** expected fail (the WA-divergence pin). No unexpected failures.

- [ ] **Step 2: Unit suite + typecheck stay green**

Run: `npm test`
Expected: all unit tests pass (282+), integration folder excluded.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm branch state**

Run: `git log --oneline -5`
Expected: spec commits + the Task 1 and Task 2 commits, all on `feat/stock-adjustment-lot-sync`. Working tree clean (`git status --short` empty).

---

## Notes for the implementer

- **Do not** add an `assertSufficientStock` call to the adjustment path — adjustments must not be blocked (Decision 3 in the spec).
- **Do not** touch `consumeFIFO`, `getWeightedAverageCost`, or `addCostLayer` — only extract from `calculateAndPostCOGS` and consume the helpers.
- The WA `it.fails` is **expected to fail** and that is success — it pins a pre-existing, out-of-scope divergence. Do not try to make it pass.
- If `npm run test:int` errors with a DB connection issue, run `npm run test:int:setup` first.
