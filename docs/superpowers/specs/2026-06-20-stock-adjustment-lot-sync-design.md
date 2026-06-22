# Stock-adjustment cost-layer sync

**Date:** 2026-06-20
**Status:** Approved (pending spec review)
**Branch:** `feat/stock-adjustment-lot-sync`
**Spec context:** continuation of `project_gl_invariant_tests` / `project_inventory_lot_vs_ledger`.

## Problem

Inventory value is tracked three ways that must always agree:
1. **Cost layers** (`InventoryLot`) — `qtyBalance × unitCost` over open lots. **This is what the Stock Valuation report reads** (`/api/v1/inventory/valuation`).
2. **Inventory ledger** (`InventoryLedgerEntry`) — per-movement running value.
3. **GL** — the Inventory asset account on the Balance Sheet.

`postStockAdjustmentToLedger` (`lib/stock-adjustment-posting.ts`) writes the **ledger + GL** but never touches **cost layers**. So after any adjustment, the valuation report drifts from the ledger and the GL. This is pinned by the `it.fails` test in `lib/__tests__/integration/stock-adjustment-invariants.int.test.ts`.

Worked example: buy 10 @ Rp1,000 (all three = Rp10,000), then a count finds 15 → post +5. Today: ledger & GL = Rp15,000, cost layers still Rp10,000 → report says Rp10,000, books say Rp15,000.

## Decisions (locked with the user)

1. **A decrease relieves cost layers at their actual carrying cost** (FIFO oldest-first, or weighted-average per the org's costing method) — exactly like a sale's COGS. The unit cost typed on the adjustment line is **ignored on decreases** (it is used only as a fallback when no layers exist). This is the only way `lots = ledger = GL` holds, and matches Accurate / standard perpetual inventory.
2. **An increase adds a new cost layer at the typed unit cost** (the declared cost of the found units).
3. **Adjustments are never blocked on insufficient layers.** No `assertSufficientStock` guard — a decrease that exceeds open layers relieves what exists and values the shortfall at `item.costPrice` (the existing `consumeFIFO` fallback). Adjustments are a correction tool; the oversell guard stays on sales only.

## Design

Make the **same cost-layer helpers be the single writer** of both lots and the inventory-ledger row for an adjustment, so the three views cannot diverge (they are written from one number, not re-derived).

### Change 1 — extract `relieveCostLayers` (DRY, behavior-preserving)

In `lib/inventory-costing.ts`, split `calculateAndPostCOGS` so its post-assertion body becomes a new exported function:

```ts
// New: relieve cost layers (FIFO or WA), write the outbound ledger row, return total cost.
// No stock-sufficiency guard — callers that need it run assertSufficientStock first.
export async function relieveCostLayers(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date,
): Promise<number>   // returns totalCost
```

`relieveCostLayers` contains exactly the current `calculateAndPostCOGS` logic *after* `assertSufficientStock`: pick method (`getOrgCostingMethod`), FIFO via `consumeFIFO` or the inline WA branch, then write the single outbound `InventoryLedgerEntry` (`valueChange = -totalCost`), and `return totalCost`.

`calculateAndPostCOGS` then becomes:
```ts
export async function calculateAndPostCOGS(tx, orgId, itemId, warehouseId, qty, docType, docId, date) {
  await assertSufficientStock(tx, orgId, itemId, warehouseId, qty)
  return relieveCostLayers(tx, orgId, itemId, warehouseId, qty, docType, docId, date)
}
```

This is a pure extraction — **no behavior change to the sales/COGS path**, which is covered by the existing GL-invariant tests (`gl-invariants.int.test.ts`).

### Change 2 — rewrite `postStockAdjustmentToLedger`

In `lib/stock-adjustment-posting.ts`, replace the `inventoryLedgerEntry.createMany` block **and** the typed-cost net computation with per-line lot operations, then post one net GL entry from the lot-derived values:

```
let netValue = 0
for (const l of lines) {
  const qtyDiff = lineQtyDiff(l)               // newQty - oldQty (or explicit diff)
  if (qtyDiff > 0) {
    const unitCost = toNumber(l.unitCost)
    await addCostLayer(tx, orgId, l.itemId, args.warehouseId ?? null,
                       qtyDiff, unitCost, ADJUSTMENT, args.id, args.date)   // writes lot + ledger
    netValue += asMoney(qtyDiff * unitCost)
  } else if (qtyDiff < 0) {
    const cost = await relieveCostLayers(tx, orgId, l.itemId, args.warehouseId ?? null,
                       -qtyDiff, ADJUSTMENT, args.id, args.date)            // relieves lots + writes ledger
    netValue -= cost
  }
  // qtyDiff === 0 → no movement
}
const netRounded = asMoney(netValue)
```

Then the **GL posting is unchanged in shape** — only the value source changes from typed-cost to `netRounded`:
- `netRounded > 0` → DR Inventory / CR Variance for `netRounded`.
- `netRounded < 0` → DR Variance / CR Inventory for `-netRounded`.
- `netRounded === 0` → no journal entry (per-line lot + ledger rows still written).
- Account resolution (`inventoryAccountId`, `varianceAccountId` via `resolveAccountDefaultId`) and the "skip JE if accounts unresolved" guard are unchanged.

Because `addCostLayer` and `relieveCostLayers` each write the lot **and** the ledger row from the same value, and the GL nets those same values, `lots = ledger = GL` by construction in every direction.

Imports: **add** `addCostLayer, relieveCostLayers` from `./inventory-costing`. All existing imports stay in use — `InventoryDocumentType` (passed as `ADJUSTMENT` to the helpers), `postJournalEntry` and `resolveAccountDefaultId`/`loadOrgAccountDefaults` (the GL entry), and `asMoney`/`toNumber` (`lineQtyDiff` + net rounding). Nothing is removed.

### Warehouse note

Pass `args.warehouseId ?? null` to the lot helpers. The codebase currently creates **all** lots warehouse-agnostic (purchases/opening pass `null`), and `consumeFIFO`/WA filter by `warehouseId` only when truthy. For the user's single-location setup `warehouseId` is `null`, so this is correct today. True per-warehouse lot scoping is part of the deferred multi-warehouse / Stock Transfer work and is **out of scope** here.

## Files touched

| File | Change |
|---|---|
| `lib/inventory-costing.ts` | Extract `relieveCostLayers`; `calculateAndPostCOGS` delegates to it (no behavior change) |
| `lib/stock-adjustment-posting.ts` | Rewrite per Change 2; drive lots+ledger via helpers; GL nets lot-derived values |
| `lib/__tests__/integration/stock-adjustment-invariants.int.test.ts` | Update scenarios to seed cost layers; assert `lots = ledger = GL` in both directions; remove `it.fails`; add FIFO-mixed-cost and weighted-average cases |

## Test changes

The current adjustment tests encode the **old** behavior (no lots; decreases valued at typed cost), so they must be updated to the new, realistic behavior:

- **increase (0 → 10):** unchanged scenario; `addCostLayer` creates a +10 @ Rp1,000 layer. Add an assertion that `inventoryLotValue == inventoryLedgerValue == inventoryAsset balance` (= Rp10,000).
- **decrease:** seed `receiveStock(item, 10, 1000)` first (lots = Rp10,000), then adjust 10 → 4. Relieves 6 @ Rp1,000 = Rp6,000. Assert inventory asset = Rp4,000, variance = +Rp6,000, and `lots == ledger == GL` (= Rp4,000).
- **net-zero batch:** seed `receiveStock(itemB, 5, 1000)`; itemA +5 (new layer @1000), itemB −5 (relieve @1000) → net 0. Assert **no new journal entry from the adjustment** (capture `journalEntryCount` before/after the adjustment, assert delta 0 — the receipt posts its own JE) and `lots == ledger` per item.
- **receipt + adjustment (increase):** existing scenario now also makes lots = Rp15,000; assert `lots == ledger == GL`.
- **remove `it.fails`** on the cost-layer reconciliation test — it now passes.
- **new — FIFO mixed cost:** receive 5 @ Rp1,000 then 5 @ Rp1,200; decrease 6. Assert COGS relieved = 5×1,000 + 1×1,200 = Rp6,200 (oldest-first), and remaining lot value == ledger == GL.
- **new — weighted-average:** set org `costingMethod = WEIGHTED_AVERAGE`; receive 5 @ Rp1,000 then 5 @ Rp1,200 (WA = Rp1,100); decrease 4 → relieved Rp4,400; assert `lots == ledger == GL`.

`relieveCostLayers` reuse means the sales COGS path is unchanged; `gl-invariants.int.test.ts` must still pass untouched.

## Out of scope (flagged follow-ups)

- **Edit/void reversal of a posted adjustment.** Re-posting or voiding an adjustment must reverse its prior lot/ledger/GL moves. This is a pre-existing gap (the ledger+GL already have it today) and is not addressed here.
- **Per-warehouse lot scoping** (multi-warehouse) — deferred with Stock Transfer.
- **Stock Opname** (structured physical count) — the separate next feature that builds on this fix.

## Acceptance criteria

1. After an **increase**, `inventoryLotValue == inventoryLedgerValue == Inventory GL balance`.
2. After a **decrease**, the same three are equal, and the value removed equals the actual FIFO/WA carrying cost of the units relieved (not the typed cost).
3. A decrease that **exceeds** open layers does **not** throw; the shortfall is valued at `item.costPrice`.
4. A **net-zero** batch writes the per-line lot + ledger rows but posts **no** adjustment journal entry.
5. The **sales/COGS path is unchanged** — `calculateAndPostCOGS` still asserts sufficient stock and posts identical COGS; `gl-invariants.int.test.ts` passes unmodified.
6. `npm run test:int` passes (including the formerly-`it.fails` test, now asserting equality); `npm run typecheck` and `npm test` stay green.
