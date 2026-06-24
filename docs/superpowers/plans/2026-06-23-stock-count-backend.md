# Stock Count — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `StockCount` data model + `/api/v1/stock-counts` API, where posting a count generates a `StockAdjustment` (book = counted, recomputed live) via the merged `postStockAdjustmentToLedger` engine.

**Architecture:** A `StockCount` header + `StockCountLine` rows (snapshot `systemQty`, nullable `countedQty`). A pure helper builds adjustment lines from a count (skip blanks/zero-variance, value against live on-hand); a `postStockCount` lib fn orchestrates generating + posting the `StockAdjustment`. Route handlers mirror the existing `stock-adjustments` route group. Frontend is a **separate plan**.

**Tech Stack:** Next.js API routes, Prisma (Postgres, `db push`), Zod, Vitest (unit + real-Postgres integration harness).

**Spec:** `docs/superpowers/specs/2026-06-23-stock-count-design.md`
**Branch:** `feat/stock-count` (spec already committed here).

**Path note:** `@/*` maps to repo root. Libs/types live at root (`lib/`, `types/`); API routes under `src/app/api/v1/`.

---

## File Structure

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `StockCountStatus` enum, `StockCount` + `StockCountLine` models; back-relations on `Organization`, `Warehouse`, `Item` |
| `lib/api-utils.ts` | Add `StockCount` entry to `NUMBER_QUERIES` |
| `types/api.ts` | Add `stockCountCreateSchema`, `stockCountUpdateSchema` (+ line schema) |
| `lib/stock-count-posting.ts` | **New.** `buildCountAdjustmentLines` (pure) + `postStockCount` (orchestration) |
| `lib/__tests__/stock-count-posting.test.ts` | **New.** Unit tests for `buildCountAdjustmentLines` |
| `src/app/api/v1/stock-counts/route.ts` | **New.** GET list + POST create/seed |
| `src/app/api/v1/stock-counts/[id]/route.ts` | **New.** GET detail + PUT save (DRAFT) |
| `src/app/api/v1/stock-counts/[id]/submit/route.ts` | **New.** DRAFT→SUBMITTED |
| `src/app/api/v1/stock-counts/[id]/reopen/route.ts` | **New.** SUBMITTED→DRAFT |
| `src/app/api/v1/stock-counts/[id]/post/route.ts` | **New.** SUBMITTED→POSTED (generates adjustment) |
| `src/app/api/v1/stock-counts/[id]/cancel/route.ts` | **New.** DRAFT/SUBMITTED→CANCELLED |
| `lib/__tests__/integration/stock-count-invariants.int.test.ts` | **New.** Post → generated adjustment, on-hand = counts, `lots = ledger = GL` |

`generatedAdjustmentId` is a **loose `String?`** (no Prisma relation), consistent with the codebase's `documentId` pattern — avoids modifying `StockAdjustment`.

---

## Task 1: Schema + number generator

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/api-utils.ts` (NUMBER_QUERIES, ~line 165)

- [ ] **Step 1: Add the enum + models to `prisma/schema.prisma`**

Add near the other inventory models (after `StockAdjustmentLine`, ~line 1088):

```prisma
enum StockCountStatus {
  DRAFT
  SUBMITTED
  POSTED
  CANCELLED
}

model StockCount {
  id                    String           @id @default(cuid())
  organizationId        String
  number                String
  date                  DateTime
  status                StockCountStatus @default(DRAFT)
  warehouseId           String?
  categoryId            String?
  countedBy             String?
  notes                 String?
  generatedAdjustmentId String?
  submittedAt           DateTime?
  postedAt              DateTime?
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt

  organization Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  warehouse    Warehouse?       @relation(fields: [warehouseId], references: [id], onDelete: SetNull)
  category     ItemCategory?    @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  lines        StockCountLine[]

  @@unique([organizationId, number])
  @@index([organizationId, date, status])
}

model StockCountLine {
  id           String   @id @default(cuid())
  stockCountId String
  lineNo       Int
  itemId       String
  systemQty    Decimal  @db.Decimal(18, 4)
  countedQty   Decimal? @db.Decimal(18, 4)
  unitCost     Decimal  @db.Decimal(18, 2)
  note         String?

  stockCount StockCount @relation(fields: [stockCountId], references: [id], onDelete: Cascade)
  item       Item       @relation(fields: [itemId], references: [id], onDelete: Restrict)

  @@unique([stockCountId, lineNo])
  @@index([stockCountId])
}
```

- [ ] **Step 2: Add the back-relation fields**

In `model Organization` (near `stockAdjustments StockAdjustment[]`):
```prisma
  stockCounts            StockCount[]
```
In `model Warehouse` (near `stockAdjustments StockAdjustment[]`):
```prisma
  stockCounts      StockCount[]
```
In `model ItemCategory` (near `items Item[]`):
```prisma
  stockCounts StockCount[]
```
In `model Item` (near `stockAdjustmentLines StockAdjustmentLine[]`):
```prisma
  stockCountLines      StockCountLine[]
```

- [ ] **Step 3: Whitelist the number generator**

In `lib/api-utils.ts`, add to the `NUMBER_QUERIES` object (after the `StockAdjustment` entry, ~line 165):
```ts
  StockCount:     (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "StockCount"`,
```

- [ ] **Step 4: Regenerate client + push schema (dev + test DB)**

Run:
```bash
npm run prisma:generate
npx prisma db push
npm run test:int:setup
```
Expected: `prisma generate` succeeds; `db push` reports the schema in sync after creating the two tables; `test:int:setup` pushes to the `_test` DB.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the generated client now has `prisma.stockCount` / `prisma.stockCountLine`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma lib/api-utils.ts
git commit -m "feat(stock-count): StockCount + StockCountLine models, number prefix SC"
```

---

## Task 2: Zod schemas

**Files:**
- Modify: `types/api.ts`

- [ ] **Step 1: Add the schemas**

In `types/api.ts`, after the stock-adjustment schemas (~line 599), add:

```ts
export const stockCountCreateSchema = z.object({
  organizationId: z.string().trim().min(1),
  date: isoDateString,
  warehouseId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  countedBy: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const stockCountLineUpdateSchema = z.object({
  itemId: z.string().trim().min(1, 'Item is required'),
  countedQty: decimalNumber.nullable().optional(), // null = not counted
  note: z.string().trim().optional(),
});

export const stockCountUpdateSchema = z.object({
  notes: z.string().trim().optional(),
  countedBy: z.string().trim().optional(),
  lines: z.array(stockCountLineUpdateSchema).optional(),
});

export type StockCountCreateInput = z.infer<typeof stockCountCreateSchema>;
export type StockCountUpdateInput = z.infer<typeof stockCountUpdateSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types/api.ts
git commit -m "feat(stock-count): zod schemas for create + update"
```

---

## Task 3: Posting lib (`buildCountAdjustmentLines` TDD + `postStockCount`)

**Files:**
- Create: `lib/stock-count-posting.ts`
- Test: `lib/__tests__/stock-count-posting.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `lib/__tests__/stock-count-posting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCountAdjustmentLines } from '../stock-count-posting';

const line = (itemId: string, systemQty: number, countedQty: number | null, unitCost = 1000) => ({
  itemId, systemQty, countedQty, unitCost,
});

describe('buildCountAdjustmentLines', () => {
  it('skips lines with no counted quantity (blank = not counted)', () => {
    const out = buildCountAdjustmentLines([line('a', 10, null)], { a: 10 });
    expect(out).toEqual([]);
  });

  it('skips zero-variance lines (counted equals live)', () => {
    const out = buildCountAdjustmentLines([line('a', 10, 8)], { a: 8 });
    expect(out).toEqual([]);
  });

  it('values the variance against LIVE on-hand, not the snapshot', () => {
    // snapshot systemQty was 10, but live is 9 (a sale happened); counted 7.
    const out = buildCountAdjustmentLines([line('a', 10, 7)], { a: 9 });
    expect(out).toEqual([{ itemId: 'a', oldQty: 9, newQty: 7, qtyDiff: -2, unitCost: 1000 }]);
  });

  it('handles a mix of up, down, blank, and zero in one batch', () => {
    const out = buildCountAdjustmentLines(
      [line('up', 5, 8), line('down', 10, 6), line('blank', 3, null), line('same', 4, 4)],
      { up: 5, down: 10, blank: 3, same: 4 },
    );
    expect(out).toEqual([
      { itemId: 'up', oldQty: 5, newQty: 8, qtyDiff: 3, unitCost: 1000 },
      { itemId: 'down', oldQty: 10, newQty: 6, qtyDiff: -4, unitCost: 1000 },
    ]);
  });

  it('treats a missing live entry as 0 on hand', () => {
    const out = buildCountAdjustmentLines([line('a', 0, 5)], {});
    expect(out).toEqual([{ itemId: 'a', oldQty: 0, newQty: 5, qtyDiff: 5, unitCost: 1000 }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- stock-count-posting`
Expected: FAIL — cannot resolve `../stock-count-posting`.

- [ ] **Step 3: Create `lib/stock-count-posting.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { toNumber } from './money';
import { nextNumber } from './api-utils';
import { postStockAdjustmentToLedger, type StockAdjustmentPostingLine } from './stock-adjustment-posting';

export interface CountLineInput {
  itemId: string;
  systemQty: unknown;   // snapshot (display only — not used for the posted variance)
  countedQty: unknown;  // null/undefined = not counted (skipped)
  unitCost: unknown;
}

/**
 * Build the StockAdjustment posting lines from a count.
 * - Only lines with a counted quantity are considered (blank = skipped).
 * - The variance is measured against LIVE on-hand (`liveQtyByItem`), so the
 *   posted adjustment moves the book to exactly the counted quantity.
 * - Zero-variance lines are dropped.
 */
export function buildCountAdjustmentLines(
  lines: CountLineInput[],
  liveQtyByItem: Record<string, number>,
): Array<StockAdjustmentPostingLine & { oldQty: number; newQty: number; qtyDiff: number; unitCost: number }> {
  const out: Array<{ itemId: string; oldQty: number; newQty: number; qtyDiff: number; unitCost: number }> = [];
  for (const l of lines) {
    if (l.countedQty === null || l.countedQty === undefined || l.countedQty === '') continue;
    const counted = toNumber(l.countedQty);
    const live = liveQtyByItem[l.itemId] ?? 0;
    const qtyDiff = counted - live;
    if (qtyDiff === 0) continue;
    out.push({ itemId: l.itemId, oldQty: live, newQty: counted, qtyDiff, unitCost: toNumber(l.unitCost) });
  }
  return out;
}

type Tx = Prisma.TransactionClient;

/**
 * Generate + post the StockAdjustment for a SUBMITTED count, in one transaction.
 * Re-reads live on-hand per item so the book becomes exactly the counts.
 * Returns the generated adjustment id (or null when nothing varied).
 */
export async function postStockCount(
  tx: Tx,
  orgId: string,
  count: { id: string; number: string; date: Date; warehouseId: string | null; lines: CountLineInput[] },
): Promise<string | null> {
  const itemIds = count.lines.map((l) => l.itemId);
  const lotRows = itemIds.length
    ? await tx.inventoryLot.groupBy({
        by: ['itemId'],
        where: { organizationId: orgId, itemId: { in: itemIds } },
        _sum: { qtyBalance: true },
      })
    : [];
  const liveQtyByItem: Record<string, number> = {};
  for (const r of lotRows) liveQtyByItem[r.itemId] = toNumber(r._sum.qtyBalance ?? 0);

  const adjLines = buildCountAdjustmentLines(count.lines, liveQtyByItem);
  if (adjLines.length === 0) return null;

  const number = await nextNumber(tx, 'StockAdjustment', 'number', 'ADJ');
  const adj = await tx.stockAdjustment.create({
    data: {
      organizationId: orgId,
      number,
      date: count.date,
      type: 'QUANTITY',
      reason: `Stock count ${count.number}`,
      warehouseId: count.warehouseId,
      status: 'APPROVED',
    },
  });
  await tx.stockAdjustmentLine.createMany({
    data: adjLines.map((l, idx) => ({
      stockAdjustmentId: adj.id,
      lineNo: idx + 1,
      itemId: l.itemId,
      oldQty: l.oldQty,
      newQty: l.newQty,
      qtyDiff: l.qtyDiff,
      unitCost: l.unitCost,
      totalValue: l.qtyDiff * l.unitCost,
    })),
  });
  await postStockAdjustmentToLedger(tx, orgId, {
    id: adj.id,
    number: adj.number,
    date: count.date,
    warehouseId: count.warehouseId,
    lines: adjLines,
  });
  return adj.id;
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npm test -- stock-count-posting`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/stock-count-posting.ts lib/__tests__/stock-count-posting.test.ts
git commit -m "feat(stock-count): buildCountAdjustmentLines + postStockCount lib"
```

---

## Task 4: Routes

**Files:**
- Create: `src/app/api/v1/stock-counts/route.ts`
- Create: `src/app/api/v1/stock-counts/[id]/route.ts`
- Create: `src/app/api/v1/stock-counts/[id]/submit/route.ts`
- Create: `src/app/api/v1/stock-counts/[id]/reopen/route.ts`
- Create: `src/app/api/v1/stock-counts/[id]/post/route.ts`
- Create: `src/app/api/v1/stock-counts/[id]/cancel/route.ts`

- [ ] **Step 1: List + create/seed** — create `src/app/api/v1/stock-counts/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, err, ok, listResponse, nextNumber, logAudit, parsePaginationParams, validateForeignKey } from '@/lib/api-utils';
import { stockCountCreateSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');
  const where: any = { organizationId: orgId, ...(status ? { status } : {}) };
  const [data, total] = await Promise.all([
    prisma.stockCount.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      include: { _count: { select: { lines: true } } },
    }),
    prisma.stockCount.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = stockCountCreateSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid stock count payload', 400);
  }
  const { date, warehouseId, categoryId, countedBy, notes } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    if (warehouseId) await validateForeignKey(tx.warehouse, { id: warehouseId, organizationId: orgId }, 'Warehouse not found in organization');
    if (categoryId) await validateForeignKey(tx.itemCategory, { id: categoryId, organizationId: orgId }, 'Category not found in organization');

    // Seed: in-scope active items + on-hand snapshot + cost.
    const items = await tx.item.findMany({
      where: { organizationId: orgId, isActive: true, type: 'PRODUCT', ...(categoryId ? { categoryId } : {}) },
      select: { id: true, costPrice: true },
      orderBy: { name: 'asc' },
    });
    const itemIds = items.map((i) => i.id);
    const lotRows = itemIds.length
      ? await tx.inventoryLot.groupBy({
          by: ['itemId'],
          where: { organizationId: orgId, itemId: { in: itemIds }, ...(warehouseId ? { warehouseId } : {}) },
          _sum: { qtyBalance: true },
        })
      : [];
    const onHand: Record<string, number> = {};
    for (const r of lotRows) onHand[r.itemId] = Number(r._sum.qtyBalance ?? 0);

    const number = await nextNumber(tx, 'StockCount', 'number', 'SC');
    const count = await tx.stockCount.create({
      data: {
        organizationId: orgId,
        number,
        date: new Date(date),
        status: 'DRAFT',
        warehouseId: warehouseId ?? null,
        categoryId: categoryId ?? null,
        countedBy: countedBy ?? null,
        notes: notes ?? null,
      },
    });
    if (items.length > 0) {
      await tx.stockCountLine.createMany({
        data: items.map((it, idx) => ({
          stockCountId: count.id,
          lineNo: idx + 1,
          itemId: it.id,
          systemQty: onHand[it.id] ?? 0,
          countedQty: null,
          unitCost: it.costPrice,
        })),
      });
    }
    return tx.stockCount.findUnique({
      where: { id: count.id },
      include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } }, orderBy: { lineNo: 'asc' } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockCount', entityId: result!.id, action: 'CREATE', payload: { number: result!.number } });
  return ok(result, 201);
});
```

- [ ] **Step 2: Detail + save** — create `src/app/api/v1/stock-counts/[id]/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';
import { ApiError } from '@/lib/errors';
import { stockCountUpdateSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({
    where: { id, organizationId: orgId },
    include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } }, orderBy: { lineNo: 'asc' } } },
  });
  if (!count) return err('Stock count not found', 404);

  // Live on-hand per line, for the "changed since count" flag.
  const itemIds = count.lines.map((l) => l.itemId);
  const lotRows = itemIds.length
    ? await prisma.inventoryLot.groupBy({ by: ['itemId'], where: { organizationId: orgId, itemId: { in: itemIds } }, _sum: { qtyBalance: true } })
    : [];
  const live: Record<string, number> = {};
  for (const r of lotRows) live[r.itemId] = Number(r._sum.qtyBalance ?? 0);
  const lines = count.lines.map((l) => {
    const liveQty = live[l.itemId] ?? 0;
    return { ...l, liveSystemQty: liveQty, changedSinceCount: liveQty !== Number(l.systemQty) };
  });

  return ok({ ...count, lines });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const body = await req.json();
  const parsed = stockCountUpdateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  const { notes, countedBy, lines } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockCount.findFirst({ where: { id, organizationId: orgId }, include: { lines: true } });
      if (!existing) throw new ApiError('Stock count not found', 404);
      if (existing.status !== 'DRAFT') throw new ApiError('Only DRAFT counts can be edited', 400);

      await tx.stockCount.update({
        where: { id },
        data: { ...(notes !== undefined ? { notes } : {}), ...(countedBy !== undefined ? { countedBy } : {}) },
      });

      if (lines) {
        const byItem = new Map(existing.lines.map((l) => [l.itemId, l]));
        const keepItemIds = new Set(lines.map((l) => l.itemId));
        // Update existing / add new (＋Add item)
        let maxLineNo = existing.lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
        for (const l of lines) {
          const found = byItem.get(l.itemId);
          const countedQty = l.countedQty === undefined ? (found ? found.countedQty : null) : l.countedQty;
          if (found) {
            await tx.stockCountLine.update({ where: { id: found.id }, data: { countedQty, note: l.note ?? null } });
          } else {
            const item = await tx.item.findFirst({ where: { id: l.itemId, organizationId: orgId, isActive: true }, select: { id: true, costPrice: true } });
            if (!item) throw new ApiError('Item not found in organization', 404);
            const lotAgg = await tx.inventoryLot.aggregate({ where: { organizationId: orgId, itemId: l.itemId }, _sum: { qtyBalance: true } });
            await tx.stockCountLine.create({
              data: { stockCountId: id, lineNo: ++maxLineNo, itemId: l.itemId, systemQty: Number(lotAgg._sum.qtyBalance ?? 0), countedQty, unitCost: item.costPrice, note: l.note ?? null },
            });
          }
        }
        // Remove lines no longer present (de-selected from the worksheet)
        const toDelete = existing.lines.filter((l) => !keepItemIds.has(l.itemId)).map((l) => l.id);
        if (toDelete.length) await tx.stockCountLine.deleteMany({ where: { id: { in: toDelete } } });
      }

      return tx.stockCount.findUnique({
        where: { id },
        include: { lines: { include: { item: { select: { id: true, name: true, sku: true } } }, orderBy: { lineNo: 'asc' } } },
      });
    });
    return ok(result);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    return err('Failed to update stock count', 500);
  }
}
```

- [ ] **Step 3: Status actions** — create the four action routes. Each guards the source status and transitions. Create `src/app/api/v1/stock-counts/[id]/submit/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!count) return err('Stock count not found', 404);
  if (count.status !== 'DRAFT') return err(`Cannot submit a ${count.status} count`, 400);
  const updated = await prisma.stockCount.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
  return ok(updated);
}
```

Create `src/app/api/v1/stock-counts/[id]/reopen/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!count) return err('Stock count not found', 404);
  if (count.status !== 'SUBMITTED') return err(`Cannot reopen a ${count.status} count`, 400);
  const updated = await prisma.stockCount.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null } });
  return ok(updated);
}
```

Create `src/app/api/v1/stock-counts/[id]/cancel/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!count) return err('Stock count not found', 404);
  if (count.status !== 'DRAFT' && count.status !== 'SUBMITTED') return err(`Cannot cancel a ${count.status} count`, 400);
  const updated = await prisma.stockCount.update({ where: { id }, data: { status: 'CANCELLED' } });
  return ok(updated);
}
```

- [ ] **Step 4: Post action** — create `src/app/api/v1/stock-counts/[id]/post/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, logAudit } from '@/lib/api-utils';
import { ApiError } from '@/lib/errors';
import { postStockCount } from '@/lib/stock-count-posting';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id, organizationId: orgId },
        include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
      });
      if (!count) throw new ApiError('Stock count not found', 404);
      if (count.status !== 'SUBMITTED') throw new ApiError(`Cannot post a ${count.status} count`, 400);

      const generatedAdjustmentId = await postStockCount(tx, orgId, {
        id: count.id,
        number: count.number,
        date: count.date,
        warehouseId: count.warehouseId,
        lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
      });

      return tx.stockCount.update({
        where: { id },
        data: { status: 'POSTED', postedAt: new Date(), generatedAdjustmentId },
      });
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockCount', entityId: id, action: 'UPDATE', payload: { action: 'POST' } });
    return ok(result);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    return err('Failed to post stock count', 500);
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/stock-counts
git commit -m "feat(stock-count): /stock-counts CRUD + submit/reopen/post/cancel routes"
```

---

## Task 5: Integration test (post → adjustment, on-hand = counts, lots = ledger = GL)

**Files:**
- Create: `lib/__tests__/integration/stock-count-invariants.int.test.ts`

- [ ] **Step 1: Write the integration test**

Create `lib/__tests__/integration/stock-count-invariants.int.test.ts`:

```ts
/**
 * Integration: posting a Stock Count generates a StockAdjustment that moves the
 * book to exactly the counted quantities, with lots = ledger = GL (FIFO).
 * Run with: npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postStockCount } from '../../stock-count-posting';
import { postBillToLedger } from '../../bill-posting';
import {
  prisma, createTestOrg, createVendor, createItem,
  assertTrialBalanced, accountBalance, inventoryLedgerValue, inventoryLotValue,
  cleanupOrg, disconnect, type TestOrg,
} from './harness';

afterAll(async () => { await disconnect(); });

const DATE = new Date('2026-06-23T00:00:00.000Z');

let billSeq = 0;
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number) {
  billSeq += 1;
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-${billSeq}`, vendorId, issueDate: DATE, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) => postBillToLedger(tx, org.orgId, {
    id: bill.id, number: bill.number, issueDate: DATE, apAccountId: null,
    taxable: false, taxInclusive: false, taxRate: 0,
    lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
  }));
}

async function onHand(orgId: string, itemId: string) {
  const r = await prisma.inventoryLot.aggregate({ where: { organizationId: orgId, itemId }, _sum: { qtyBalance: true } });
  return Number(r._sum.qtyBalance ?? 0);
}

async function seedCount(org: TestOrg, lines: Array<{ itemId: string; systemQty: number; countedQty: number | null; unitCost: number }>) {
  const count = await prisma.stockCount.create({
    data: {
      organizationId: org.orgId, number: `SC-${billSeq}-${Math.round(lines.length)}`, date: DATE, status: 'SUBMITTED', warehouseId: null,
      lines: { create: lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })) },
    },
    include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
  });
  return count;
}

describe('GL invariant: stock count post', () => {
  it('a count-down posts an adjustment so on-hand equals the count, lots = ledger = GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId, 1000);
    await receiveStock(org, itemId, 10, 1000); // on-hand 10, lots/ledger/GL = 10000

    const count = await seedCount(org, [{ itemId, systemQty: 10, countedQty: 7, unitCost: 1000 }]);
    const adjId = await prisma.$transaction((tx) => postStockCount(tx, org.orgId, {
      id: count.id, number: count.number, date: DATE, warehouseId: null,
      lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
    }));

    expect(adjId).toBeTruthy();
    expect(await onHand(org.orgId, itemId)).toBeCloseTo(7, 4); // book == counted
    const gl = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    expect(gl).toBeCloseTo(7000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(7000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(7000, 2);
    await assertTrialBalanced(org.orgId, 'stock count down');

    await cleanupOrg(org.orgId);
  });

  it('skips blank and zero-variance lines (no adjustment when nothing varied)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId, 1000);
    await receiveStock(org, itemId, 5, 1000);

    // counted equals live → zero variance
    const count = await seedCount(org, [{ itemId, systemQty: 5, countedQty: 5, unitCost: 1000 }]);
    const adjId = await prisma.$transaction((tx) => postStockCount(tx, org.orgId, {
      id: count.id, number: count.number, date: DATE, warehouseId: null,
      lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
    }));

    expect(adjId).toBeNull(); // no adjustment generated
    expect(await onHand(org.orgId, itemId)).toBeCloseTo(5, 4);

    await cleanupOrg(org.orgId);
  });
});
```

- [ ] **Step 2: Run it (sets up DB if needed)**

Run: `npm run test:int:setup && npm run test:int -- stock-count`
Expected: PASS — 2 tests. (Setup pushes the new tables to the `_test` DB.)

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/integration/stock-count-invariants.int.test.ts
git commit -m "test(stock-count): integration — post generates adjustment, on-hand = counts, lots = ledger = GL"
```

---

## Task 6: Final verification sweep

**Files:** none.

- [ ] **Step 1: Full suites + typecheck**

Run: `npm run test:int` → all pass (gl-invariants, stock-adjustment 7+1 expected-fail, stock-count 2).
Run: `npm test` → all unit tests pass (incl. the new `stock-count-posting` suite).
Run: `npm run typecheck` → clean.

- [ ] **Step 2: Confirm branch state**

Run: `git log --oneline main..HEAD` — spec + Tasks 1-5 commits on `feat/stock-count`. `git status --short` clean.

---

## Notes for the implementer

- `generatedAdjustmentId` is a loose `String?` — do **not** add a Prisma relation to `StockAdjustment`.
- The generated `StockAdjustment` is created with `status: 'APPROVED'` (it is already posted by `postStockAdjustmentToLedger`).
- Do **not** add an `assertSufficientStock` guard anywhere — adjustments/counts are corrections.
- If `npm run test:int` can't connect, run `npm run test:int:setup` first.
- The frontend (nav item, workbench list, count worksheet, posted-detail Journal Entry tab) is a **separate plan** built once this API is live; the posted-detail journal view will reuse the app's existing document-journal pattern.
