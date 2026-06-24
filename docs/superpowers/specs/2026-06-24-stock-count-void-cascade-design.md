# Stock-count void cascade (Void Integrity Phase 5 follow-up)

**Date:** 2026-06-24
**Branch:** stacked on `claude/void-integrity-phase5-stock-adj` (PR #56)

## Problem

Phase 5 added a void endpoint for stock adjustments
(`POST /api/v1/stock-adjustments/[id]/void` → `lib/stock-adjustment-void.ts`).
When a stock **count** is posted, it generates a `StockAdjustment` and links it
via `StockCount.generatedAdjustmentId` (stock-count post route + `postStockCount`).

That generated adjustment can now be voided **independently**. When it is:

- The GL is reversed correctly (append-only storno via `reverseJournalEntry` —
  the original variance JE stays `POSTED`, a `REVERSAL` entry nets it to zero).
- The inventory is unwound correctly (`reverseAdjustmentInventory`).
- The adjustment is marked `VOID`.

But the owning `StockCount` is **not** updated:

- It still shows status `POSTED`.
- Its `/journal` route resolves the JE purely by memo `Stock adjustment:
  <number>` + `status: POSTED`, so it still returns the original (now
  superseded) entry.

Net result: a count that reads "Posted" with a live journal, while its
accounting has actually been reversed — contradictory UI/state.

## Decision

**Cascade** the void back to the owning count (chosen over blocking the void +
adding a separate count-level reverse endpoint). Rationale: the generated
adjustment is a real, user-visible `StockAdjustment` row reachable from the
Inventory Adjustments UI; voiding from there should "just work" and clean up the
count, with no new endpoint/RBAC/button surface. The existing adjustment-void
RBAC and endpoint are reused.

## Design

### Schema
- Add `VOIDED` to `StockCountStatus` (`DRAFT | SUBMITTED | POSTED | CANCELLED |
  VOIDED`). Applied via `prisma db push` at merge, alongside Phase 5's existing
  `StockAdjustmentStatus.VOID` migration. (Integration test DB picks it up via
  `npm run test:int:setup`.)

### Cascade (layering: stock-count depends on stock-adjustment, never reverse)
- New `lib/stock-count-void.ts` →
  `voidStockCountForAdjustment(tx, orgId, adjustmentId)`:
  - Find the `StockCount` where `generatedAdjustmentId === adjustmentId` (org
    scoped).
  - If none → no-op (adjustment wasn't count-generated).
  - If found and status `POSTED` → set status `VOIDED`. Returns the count id (or
    null), so the route can audit-log it.
  - If found but not `POSTED` → no-op (defensive; shouldn't occur).
  - `generatedAdjustmentId` is **kept** for audit trail.
- `voidStockAdjustment` stays pure (no stock-count import — avoids a dependency
  cycle, since `stock-count-posting` already imports `stock-adjustment-posting`).
- The **void route** orchestrates both inside its existing single
  `prisma.$transaction`: `voidStockAdjustment(...)` → then
  `voidStockCountForAdjustment(...)`. Atomic — the count can never be left
  half-updated relative to the GL/inventory reversal.

### Journal route VOID-awareness
- `GET /api/v1/stock-counts/[id]/journal` additionally selects the generated
  adjustment's `status`; if `VOID`, returns `ok(null)` (the original JE was
  reversed → there is no live posted journal). The FK linkage stays for history.

### Behavior semantics
- `VOIDED` is terminal. To redo a count after reversal, create a new one
  (matches accounting reversal; no re-post path — YAGNI). Existing
  `cancel`/`reopen`/`post` guards already reject non-matching statuses, so a
  `VOIDED` count is inert.

### Frontend (minimal)
- `StockCounts.tsx`: add a `VOIDED → { status: 'Error', label: 'Voided' }` case
  to `countStatusTag`, and a "Voided" option to the status filter. (`StockCount.status`
  is typed `string`, so no type change needed.) No new buttons.

## Out of scope
- Concurrency hardening of the void path (inherits Phase 5's pattern).
- Multi-warehouse.
- A separate count-level reverse endpoint (rejected alternative).

## Test plan
- **Unit** `lib/__tests__/stock-count-void.test.ts` (mocked tx): cascades a
  POSTED count → `VOIDED`; no-op when no owning count; no-op when count not
  POSTED.
- **Integration** `lib/__tests__/integration/stock-count-void-cascade.int.test.ts`
  (real PG): submit → post count (asserts adjustment + JE + inventory created) →
  void adjustment + cascade → assert adjustment `VOID`, count `VOIDED`, trial
  balance balanced (original + reversal net zero), inventory restored, and the
  journal-resolution yields null (generated adjustment is `VOID`).
- **Route** extend `src/app/api/v1/__tests__/stock-adjustment-void-route.test.ts`:
  the void route invokes the cascade. Plus a journal-route test asserting it
  returns null when the generated adjustment is `VOID`.
