# Stock Count (physical count / opname)

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Branch:** `feat/stock-count`
**Builds on:** the merged stock-adjustment cost-layer sync ([[project_inventory_lot_vs_ledger]], `lib/stock-adjustment-posting.ts`) and the Accurate-aligned side-nav ([[project_sidenav_restructure]]).

## Purpose

A **Stock Count** is a structured physical-count session: you snapshot what the system thinks is on hand, enter what you physically counted, review the variances, and on post it **generates a `StockAdjustment`** that moves the books to match your count. It is distinct from a plain Stock Adjustment:

| | Stock Adjustment | Stock Count |
|---|---|---|
| What | A direct correction that posts to the GL | A physical-count session (worksheet) |
| Use | A known one-off change (damage, write-off) | Verify reality (periodic / cycle count) |
| Items | You pick the few you're correcting | Auto-seeded for a category / warehouse / everything |
| Input | Type the new qty | System snapshots qty; you enter counted qty; variance computed |
| Workflow | One step (create & post) | Two-step (count → review → post) |
| GL | Posts directly | Generates a `StockAdjustment` which posts |

The Stock Adjustment is the posting engine; the Stock Count is the disciplined workflow that drives it and leaves an audit trail.

## Decisions (locked with the user)

1. **Separate `StockCount` entity that generates a `StockAdjustment` on post** (not an extension of `StockAdjustment`).
2. **Scope:** optional `categoryId` and/or `warehouseId` filter; null filter = everything. Items are **auto-seeded** from the scope when the count is created, plus a **"＋ Add item"** picker to append items outside the seed.
3. **Two-step workflow:** `DRAFT → SUBMITTED → POSTED`, plus `CANCELLED`. A reviewer can **Reopen** (`SUBMITTED → DRAFT`) to fix a count, **Post** (`SUBMITTED → POSTED`), or **Cancel**.
4. **Blanks are skipped:** only lines with a `countedQty` entered generate a variance/adjustment. Uncounted lines are left untouched. To record a true zero, type `0`.
5. **Book = counted, recomputed live at post:** at post, variance is computed against **live** system on-hand (`oldQty = live`, `newQty = countedQty`), so after posting, on-hand equals exactly what you counted. The review screen shows a non-blocking **"system changed since count"** flag on any line where live on-hand differs from the line's `systemQty` snapshot.
6. **Notes:** a session-level `notes` and a per-line `note` (annotate individual items while counting).
7. **Workbench UI** matching Sales Invoices: a `DocumentTabBar` (Catalog + ＋New + open document tabs); a posted count's detail has **Summary / Journal Entry / Lines** tabs and a link to the generated adjustment. English label **"Stock Counts"** in the Inventory nav group (beside Stock Adjustments).

## Data model

New enum + two tables; everything downstream is reused.

```prisma
enum StockCountStatus {
  DRAFT
  SUBMITTED
  POSTED
  CANCELLED
}

model StockCount {
  id                    String   @id @default(cuid())
  organizationId        String
  number                String   // auto, e.g. SC-00001
  date                  DateTime
  status                StockCountStatus @default(DRAFT)
  warehouseId           String?  // scope filter used to seed (null = all)
  categoryId            String?  // scope filter used to seed (null = all)
  countedBy             String?  // free text (no user FK in v1)
  notes                 String?
  generatedAdjustmentId String?  // set on POST — links to the StockAdjustment it created
  submittedAt           DateTime?
  postedAt              DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  organization        Organization     @relation(...)
  warehouse           Warehouse?       @relation(...)
  category            ItemCategory?    @relation(...)
  generatedAdjustment StockAdjustment? @relation(...)
  lines               StockCountLine[]

  @@unique([organizationId, number])
}

model StockCountLine {
  id           String   @id @default(cuid())
  stockCountId String
  lineNo       Int
  itemId       String
  systemQty    Decimal  @db.Decimal(18, 4) // snapshot of on-hand when the line was seeded/added
  countedQty   Decimal? @db.Decimal(18, 4) // nullable — null = not counted (skipped at post)
  unitCost     Decimal  @db.Decimal(18, 2) // snapshot of item.costPrice (used only to value increases; decreases relieve at carrying cost)
  note         String?

  stockCount StockCount @relation(..., onDelete: Cascade)
  item       Item       @relation(...)
}
```

Variance (`countedQty − systemQty`) is derived, not stored. Reused unchanged: the on-hand read (`inventoryLot` sum of `qtyBalance`), `StockAdjustment` + `postStockAdjustmentToLedger`, and the `JournalEntry` the adjustment creates.

## Backend — `/api/v1/stock-counts`

- **`POST /stock-counts`** — create + seed. Body `{ date, warehouseId?, categoryId?, countedBy?, notes? }`. Server:
  1. Finds in-scope active items (filter by `categoryId` when given).
  2. For each, snapshots on-hand (`inventoryLot.groupBy _sum.qtyBalance`, filtered by `warehouseId` when given) and `unitCost = item.costPrice` (the item's standard cost; used only to value count-up lines).
  3. Writes one `StockCountLine` per item (`systemQty`, `countedQty = null`, `unitCost`). Status `DRAFT`, number from `nextNumber(tx, 'StockCount', 'number', 'SC')`.
- **`GET /stock-counts`** — paginated list (number, date, status, line/variance counts). Supports `status` filter.
- **`GET /stock-counts/[id]`** — detail with lines (+ item), and **when `POSTED`, the generated adjustment's journal lines** (Dr/Cr) for the Journal Entry tab. Also returns a per-line `liveSystemQty` + `changedSinceCount` flag computed at read time (live on-hand vs `systemQty`).
- **`PUT /stock-counts/[id]`** — save `countedQty` + per-line `note` (+ header `notes`, `countedBy`) and add/remove lines (the ＋Add item). **Only while `DRAFT`.**
- **`POST /stock-counts/[id]/submit`** — `DRAFT → SUBMITTED` (sets `submittedAt`).
- **`POST /stock-counts/[id]/reopen`** — `SUBMITTED → DRAFT`.
- **`POST /stock-counts/[id]/post`** — `SUBMITTED → POSTED`, in one transaction:
  1. For each line with `countedQty != null`: re-read **live** system on-hand → `oldQty = live`, `newQty = countedQty`, `qtyDiff = counted − live`. Drop zero-variance lines.
  2. If any variance lines remain, create a `StockAdjustment` (`reason: "Stock count {number}"`, `type: QUANTITY`, lines with `oldQty/newQty/qtyDiff/unitCost`) and call `postStockAdjustmentToLedger` → cost layers + ledger + GL move so the book equals the counts. (Period-lock + GL integrity come from the adjustment engine.)
  3. Set `generatedAdjustmentId`, `postedAt`, status `POSTED`.
  4. If **no** variance lines (everything matched), still mark `POSTED` with no generated adjustment.
- **`POST /stock-counts/[id]/cancel`** — `DRAFT|SUBMITTED → CANCELLED`.

Input validation via a `stockCountInputSchema` (zod) in `src/types/api.ts`. RBAC reuses the existing **`inv_adj`** permission (post is the GL-affecting action). Period-lock is enforced transitively by `postStockAdjustmentToLedger`.

## Frontend

- **Nav:** add **Stock Counts** → `/inventory/counts` to the Inventory group in `src/components/Layout/Sidebar.tsx` (between Item Categories and Stock Adjustments); RBAC via `inv_adj`; permission-map entry in `useAccessStore.ts`.
- **Routes** (`src/App.tsx`): `/inventory/counts` (workbench list), `/inventory/counts/new` (create/seed), and the workbench detail by `?countId=` (same tab pattern as invoices via `useDocumentTabs`).
- **Workbench list** (`src/views/inventory/StockCounts.tsx`) — `DocumentTabBar` with Catalog + "＋ New count"; table of past counts (number, date, status `StatusTag`, scope, net variance, # counted). Reuses `ListPage`/`Table`/`StatusTag`/`Button`.
- **Count worksheet** (create/edit, `DRAFT`) — scope chips (category/warehouse/counted-by), "X of Y counted" progress, table: Item · System qty (read-only) · **Counted** (input) · **Variance** (live, success/danger/neutral) · **Note** (input), a **＋ Add item** row (searchable item picker), and **Save draft / Submit for review** actions.
- **Review screen** (`SUBMITTED`) — same table, counts read-only, a **"system changed since count"** flag per affected row, a variance summary (items counted, net value), and **Reopen / Cancel / Post** actions.
- **Posted detail** (`POSTED`) — **Summary** (lines + variances), **Journal Entry** (Dr/Cr table of the generated adjustment, reusing the existing journal/audit detail pattern), **Lines**, and a link to the generated `StockAdjustment`. Draft/Submitted show a variance preview, not a journal.
- React Query hooks in `src/hooks/useInventory.ts` (`useStockCounts`, `useStockCount`, create/update/submit/reopen/post/cancel mutations).

Status → `StatusTag` tone: Draft = neutral, Submitted = warning, Posted = success, Cancelled = neutral/danger. Theme is inherited from the shared components (verified against `src/index.css` tokens — sky-blue primary `#228be6`, neutral grey Draft badge).

## Out of scope (flagged follow-ups)

- **Aligning the existing Stock Adjustments screen to the same workbench/detail pattern** (it has a list + form today; the Catalog+＋New+Journal-tab treatment is a separate, aligned follow-up — not bloating this spec).
- **Freezing/locking stock movements during an open count** — we instead recompute against live qty at post and flag changes; a hard freeze is out of scope.
- **Per-warehouse cost-layer scoping** (lots are warehouse-agnostic today; deferred with multi-warehouse / Stock Transfer).
- **Weighted-average lot divergence** (pre-existing; pinned `it.fails` — unaffected here).

## Acceptance criteria

1. Creating a count with a category scope seeds one line per in-scope active item, each with its current `systemQty` snapshot and `countedQty = null`; no category = all items.
2. ＋Add item appends an item not in the seed with its `systemQty` snapshot.
3. Saving counts + notes works only while `DRAFT`; Submit moves to `SUBMITTED` (counts locked); Reopen returns to `DRAFT`.
4. Posting a `SUBMITTED` count generates a `StockAdjustment` from the **non-zero, counted** variance lines (blanks and zero-variance skipped), valued against **live** on-hand, and posts it via `postStockAdjustmentToLedger`; the count links `generatedAdjustmentId` and becomes `POSTED`. After posting, each counted item's on-hand equals its counted qty.
4b. Posting a count where everything matched (no variances) marks it `POSTED` with no generated adjustment and no journal.
5. The posted detail shows the generated adjustment's balanced Dr/Cr journal lines and links to it; draft/submitted show a variance preview, not a journal.
6. The review screen flags any line whose live on-hand differs from its `systemQty` snapshot ("system changed since count"), non-blocking.
7. A count cannot be edited or posted after `POSTED`; `CANCELLED` is terminal.
8. RBAC: a user without `inv_adj` view cannot see Stock Counts; posting requires `inv_adj` create/edit.
9. New unit tests cover the post logic (seed → count → live variance → generated adjustment lines: skip blanks, skip zero-variance, mixed increase/decrease); existing `npm test` + `npm run test:int` + `npm run typecheck` stay green. The integration harness gains a stock-count → generated-adjustment reconciliation test asserting on-hand equals counts and `lots = ledger = GL` after post (FIFO).
