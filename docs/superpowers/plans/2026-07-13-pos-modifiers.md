# POS Modifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modifier / option-group engine to the POS so a cashier can attach add-ons (price-only or real-item-backed) to a cart line at checkout, with item-linked options depleting stock + posting COGS through the existing per-line engine.

**Architecture:** Approach A (child lines). New master-data models (`ModifierGroup`, `ModifierOption`, `ModifierAttachment`). At checkout, each priced/item-linked selected option becomes its own child `SalesInvoiceLine` (linked via `parentLineNo`, flagged `isModifier`); free ($0, no-item) options land in the base line's `modifierNote`. Item-linked child lines reuse `postInvoiceSend` for stock+COGS — no new GL code. Resolution unions item-attached and category-attached groups.

**Tech Stack:** Next.js (App Router) API routes, Prisma + PostgreSQL, Zod (`src/types/api.ts`), Vitest (unit + integration), React (POS PWA under `src/pos/`, settings under `src/views`/`src/components`). RBAC via `withPermission` (`lib/authz.ts`), reusing the existing `POS_RETAIL` ModuleKey (no new enum value — avoids RBAC seed churn).

**Spec:** `docs/superpowers/specs/2026-07-13-pos-modifiers-design.md`

---

## File Structure

**Create**
- `lib/pos/modifier-resolution.ts` — resolve applicable groups for an item (item ∪ category, dedupe, order, active-only)
- `lib/pos/modifier-lines.ts` — `flattenSaleLines`: turn configured cart lines into flat base+child materialized lines
- `lib/pos/__tests__/modifier-resolution.test.ts`
- `lib/pos/__tests__/modifier-lines.test.ts`
- `src/app/api/v1/modifier-groups/route.ts` + `src/app/api/v1/modifier-groups/[id]/route.ts`
- `src/app/api/v1/modifier-attachments/route.ts` + `src/app/api/v1/modifier-attachments/[id]/route.ts`
- `src/pos/components/ModifierModal.tsx` — the register selection pop-up
- `src/views/settings/ModifierSettings.tsx` — back-office CRUD screen
- `lib/__tests__/integration/pos-modifiers.int.test.ts`

**Modify**
- `prisma/schema.prisma` — new models, `ModifierSelectionType` enum, back-relations, 3 new `SalesInvoiceLine` columns
- `src/types/api.ts` — Zod schemas for modifier CRUD + extend the POS sale line schema with `modifiers[]`
- `lib/pos/pricing.ts` — extend `SaleLineInput` with optional `modifiers`
- `src/pos/state/cart.ts` — configured line identity + required-group gating + carry modifiers into `toSaleLines`
- `lib/pos/sale-posting.ts` — call `flattenSaleLines` before FEFO/create so child lines materialize
- `src/app/api/v1/pos/catalog/route.ts` — include each item's resolved modifier groups+options
- `src/pos/hooks/usePos.ts` (+ `useOfflinePos.ts`) and `src/pos/components/ProductTile.tsx`/`CartLines.tsx` — open modal + render options
- `src/pos/offline/db.ts` — persist modifier data in the offline catalog cache

---

## Task 1: Prisma schema — models, enum, columns

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the enum and three models** (place near the other POS models, after `PosSalesTarget`)

```prisma
enum ModifierSelectionType {
  SINGLE
  MULTI
}

model ModifierGroup {
  id             String                @id @default(cuid())
  organizationId String
  name           String
  selectionType  ModifierSelectionType @default(SINGLE)
  isRequired     Boolean               @default(false)
  sortOrder      Int                   @default(0)
  isActive       Boolean               @default(true)
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  organization Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  options      ModifierOption[]
  attachments  ModifierAttachment[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

model ModifierOption {
  id         String  @id @default(cuid())
  groupId    String
  name       String
  priceDelta Decimal @default(0) @db.Decimal(18, 2)
  itemId     String?
  sortOrder  Int     @default(0)
  isActive   Boolean @default(true)

  group ModifierGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  item  Item?         @relation(fields: [itemId], references: [id], onDelete: SetNull)

  @@index([groupId])
  @@index([itemId])
}

model ModifierAttachment {
  id             String  @id @default(cuid())
  organizationId String
  groupId        String
  itemId         String?
  itemCategoryId String?

  group        ModifierGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  item         Item?         @relation(fields: [itemId], references: [id], onDelete: Cascade)
  itemCategory ItemCategory? @relation(fields: [itemCategoryId], references: [id], onDelete: Cascade)

  @@index([organizationId, itemId])
  @@index([organizationId, itemCategoryId])
  @@index([groupId])
}
```

- [ ] **Step 2: Add the three columns to `SalesInvoiceLine`** (inside the existing model, after `performedById`)

```prisma
  parentLineNo  Int?
  isModifier    Boolean  @default(false)
  modifierNote  String?
```

- [ ] **Step 3: Add back-relations** to existing models:

In `model Organization {` add:
```prisma
  modifierGroups      ModifierGroup[]
  modifierAttachments ModifierAttachment[]
```
In `model Item {` add:
```prisma
  modifierOptions     ModifierOption[]
  modifierAttachments ModifierAttachment[]
```
In `model ItemCategory {` add:
```prisma
  modifierAttachments ModifierAttachment[]
```

- [ ] **Step 4: Apply schema and regenerate client**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema." and client regenerated with `ModifierGroup`, `ModifierOption`, `ModifierAttachment` available on `prisma`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(pos): add modifier data model + child-line columns"
```

---

## Task 2: Shared types + Zod schemas

**Files:**
- Modify: `lib/pos/pricing.ts`
- Modify: `src/types/api.ts`

- [ ] **Step 1: Extend `SaleLineInput`** in `lib/pos/pricing.ts` (add optional field; do NOT change `computeSaleTotals` — child lines are added as their own lines later, so totals still sum price×qty correctly)

```ts
export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number; // tax-inclusive, may be 0
  itemId?: string | null;
}

export interface SaleLineInput {
  itemId: string;
  description: string;
  quantity: number;
  price: number;
  discountPct: number;
  performedById?: string | null;
  modifiers?: SelectedModifier[]; // NEW — selected options for this line
}
```

- [ ] **Step 2: Add Zod schemas** in `src/types/api.ts` (follow the existing schema style in that file). Add:

```ts
export const modifierOptionInputSchema = z.object({
  name: z.string().min(1),
  priceDelta: z.number().default(0),
  itemId: z.string().nullish(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const modifierGroupInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  selectionType: z.enum(['SINGLE', 'MULTI']).default('SINGLE'),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  options: z.array(modifierOptionInputSchema).default([]),
});

export const modifierAttachmentInputSchema = z
  .object({
    organizationId: z.string(),
    groupId: z.string(),
    itemId: z.string().nullish(),
    itemCategoryId: z.string().nullish(),
  })
  .refine((v) => !!v.itemId !== !!v.itemCategoryId, {
    message: 'Attach to exactly one of itemId or itemCategoryId',
  });

export const selectedModifierSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  optionId: z.string(),
  optionName: z.string(),
  priceDelta: z.number(),
  itemId: z.string().nullish(),
});
```

- [ ] **Step 3: Wire `modifiers` into the POS sale line schema.** Find `createPosSaleSchema` in `src/types/api.ts`; on its `lines` element object add:

```ts
  modifiers: z.array(selectedModifierSchema).optional(),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/pos/pricing.ts src/types/api.ts
git commit -m "feat(pos): modifier types + zod schemas"
```

---

## Task 3: Group resolution helper (pure, TDD)

**Files:**
- Create: `lib/pos/modifier-resolution.ts`
- Test: `lib/pos/__tests__/modifier-resolution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveItemGroups, type GroupWithAttach } from '../modifier-resolution';

const g = (id: string, over: Partial<GroupWithAttach> = {}): GroupWithAttach => ({
  id, name: id, selectionType: 'SINGLE', isRequired: false, sortOrder: 0, isActive: true,
  options: [], attachedItemIds: [], attachedCategoryIds: [], ...over,
});

describe('resolveItemGroups', () => {
  it('unions item-attached and category-attached groups', () => {
    const groups = [
      g('milk', { attachedCategoryIds: ['coffee'] }),
      g('addons', { attachedItemIds: ['latte'] }),
      g('other', { attachedItemIds: ['tea'] }),
    ];
    const res = resolveItemGroups(groups, { itemId: 'latte', categoryId: 'coffee' });
    expect(res.map((x) => x.id)).toEqual(['milk', 'addons']);
  });

  it('dedupes a group attached via both item and category', () => {
    const groups = [g('milk', { attachedItemIds: ['latte'], attachedCategoryIds: ['coffee'] })];
    const res = resolveItemGroups(groups, { itemId: 'latte', categoryId: 'coffee' });
    expect(res).toHaveLength(1);
  });

  it('orders by sortOrder then name and drops inactive groups/options', () => {
    const groups = [
      g('b', { sortOrder: 2, attachedItemIds: ['x'] }),
      g('a', { sortOrder: 1, attachedItemIds: ['x'], options: [
        { id: 'o1', name: 'on', priceDelta: 0, itemId: null, sortOrder: 0, isActive: true },
        { id: 'o2', name: 'off', priceDelta: 0, itemId: null, sortOrder: 1, isActive: false },
      ] }),
      g('z', { isActive: false, attachedItemIds: ['x'] }),
    ];
    const res = resolveItemGroups(groups, { itemId: 'x', categoryId: null });
    expect(res.map((x) => x.id)).toEqual(['a', 'b']);
    expect(res[0].options.map((o) => o.id)).toEqual(['o1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pos/__tests__/modifier-resolution.test.ts`
Expected: FAIL — cannot find module `../modifier-resolution`.

- [ ] **Step 3: Write the implementation**

```ts
export interface ResolvedOption {
  id: string; name: string; priceDelta: number; itemId: string | null; sortOrder: number; isActive: boolean;
}
export interface GroupWithAttach {
  id: string; name: string;
  selectionType: 'SINGLE' | 'MULTI';
  isRequired: boolean; sortOrder: number; isActive: boolean;
  options: ResolvedOption[];
  attachedItemIds: string[];
  attachedCategoryIds: string[];
}

/** Groups applicable to an item = item-attached ∪ category-attached, active only,
 *  active options only, ordered by sortOrder then name. Pure — caller supplies data. */
export function resolveItemGroups(
  groups: GroupWithAttach[],
  ctx: { itemId: string; categoryId: string | null },
): GroupWithAttach[] {
  const seen = new Set<string>();
  const out: GroupWithAttach[] = [];
  for (const grp of groups) {
    if (!grp.isActive || seen.has(grp.id)) continue;
    const byItem = grp.attachedItemIds.includes(ctx.itemId);
    const byCat = ctx.categoryId != null && grp.attachedCategoryIds.includes(ctx.categoryId);
    if (!byItem && !byCat) continue;
    seen.add(grp.id);
    out.push({
      ...grp,
      options: grp.options
        .filter((o) => o.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pos/__tests__/modifier-resolution.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pos/modifier-resolution.ts lib/pos/__tests__/modifier-resolution.test.ts
git commit -m "feat(pos): modifier group resolution helper"
```

---

## Task 4: Cart configured-line identity + required gating (TDD)

**Files:**
- Modify: `src/pos/state/cart.ts`
- Test: `src/pos/state/__tests__/cart.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing tests** (append to the existing describe block)

```ts
import { addConfiguredItem, lineKey, requiredGroupsSatisfied } from '../cart';

const coffee = { id: 'coffee', sku: 'C', name: 'Coffee', sellingPrice: 20000 };
const oat = { groupId: 'milk', groupName: 'Milk', optionId: 'oat', optionName: 'Oat', priceDelta: 5000, itemId: 'oatItem' };

it('keeps a configured line separate from a plain line, merges identical configs', () => {
  let c = addItem(emptyCart(), coffee);           // plain coffee
  c = addConfiguredItem(c, coffee, [oat]);          // coffee + oat
  c = addConfiguredItem(c, coffee, [oat]);          // same config again → qty++
  expect(c.lines).toHaveLength(2);
  const configured = c.lines.find((l) => l.modifiers.length === 1)!;
  expect(configured.quantity).toBe(2);
});

it('displayed unit price adds priceDeltas', () => {
  const c = addConfiguredItem(emptyCart(), coffee, [oat]);
  expect(c.lines[0].price).toBe(25000);
});

it('requiredGroupsSatisfied is false when a required group has no selection', () => {
  const groups = [{ id: 'milk', isRequired: true }, { id: 'addons', isRequired: false }];
  expect(requiredGroupsSatisfied(groups, [oat])).toBe(true);
  expect(requiredGroupsSatisfied(groups, [])).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pos/state/__tests__/cart.test.ts`
Expected: FAIL — `addConfiguredItem`/`lineKey`/`requiredGroupsSatisfied` not exported.

- [ ] **Step 3: Implement.** Update `CartLine` and add helpers in `src/pos/state/cart.ts`:

```ts
import type { SelectedModifier } from '@/lib/pos/pricing';

export interface CartLine {
  key: string;                 // NEW stable identity (itemId + modifier hash)
  itemId: string;
  name: string;
  price: number;               // base + Σ priceDelta (tax-inclusive)
  quantity: number;
  discountPct: number;
  modifiers: SelectedModifier[]; // NEW
  earliestExpiry?: string | null;
}

/** Stable identity for a configured line: itemId + sorted option ids. */
export function lineKey(itemId: string, mods: SelectedModifier[]): string {
  const ids = mods.map((m) => m.optionId).sort().join(',');
  return ids ? `${itemId}#${ids}` : itemId;
}

export function addConfiguredItem(cart: Cart, item: CatalogItem, mods: SelectedModifier[]): Cart {
  const key = lineKey(item.id, mods);
  const existing = cart.lines.find((l) => l.key === key);
  if (existing) {
    return { lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)) };
  }
  const price = item.sellingPrice + mods.reduce((s, m) => s + m.priceDelta, 0);
  return {
    lines: [...cart.lines, {
      key, itemId: item.id, name: item.name, price, quantity: 1, discountPct: 0,
      modifiers: mods, earliestExpiry: item.earliestExpiry ?? null,
    }],
  };
}

export function requiredGroupsSatisfied(
  groups: { id: string; isRequired: boolean }[],
  mods: SelectedModifier[],
): boolean {
  const chosen = new Set(mods.map((m) => m.groupId));
  return groups.filter((g) => g.isRequired).every((g) => chosen.has(g.id));
}
```

Then update the existing functions that key on `itemId` to key on `key` instead: `addItem` (set `key: item.id, modifiers: []`), `setQty`, `setDiscount`, `removeLine` take a `key: string` argument instead of `itemId`. Update `toSaleLines` to include modifiers:

```ts
export function addItem(cart: Cart, item: CatalogItem): Cart {
  const existing = cart.lines.find((l) => l.key === item.id);
  if (existing) return { lines: cart.lines.map((l) => (l.key === item.id ? { ...l, quantity: l.quantity + 1 } : l)) };
  return { lines: [...cart.lines, { key: item.id, itemId: item.id, name: item.name, price: item.sellingPrice, quantity: 1, discountPct: 0, modifiers: [], earliestExpiry: item.earliestExpiry ?? null }] };
}
export function setQty(cart: Cart, key: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, key);
  return { lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) };
}
export function setDiscount(cart: Cart, key: string, discountPct: number): Cart {
  const clamped = Math.max(0, Math.min(100, discountPct));
  return { lines: cart.lines.map((l) => (l.key === key ? { ...l, discountPct: clamped } : l)) };
}
export function removeLine(cart: Cart, key: string): Cart {
  return { lines: cart.lines.filter((l) => l.key !== key) };
}
export function toSaleLines(cart: Cart): SaleLineInput[] {
  return cart.lines.map((l) => ({
    itemId: l.itemId, description: l.name, quantity: l.quantity, price: l.price,
    discountPct: l.discountPct, modifiers: l.modifiers,
  }));
}
```

- [ ] **Step 4: Update existing callers** that pass `itemId` to `setQty`/`setDiscount`/`removeLine` (grep for them): `src/pos/components/CartLines.tsx` and any view — pass `line.key` instead of `line.itemId`. Run the existing cart tests + typecheck.

Run: `npx vitest run src/pos/state/__tests__/cart.test.ts && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/pos/state/cart.ts src/pos/state/__tests__/cart.test.ts src/pos/components/CartLines.tsx
git commit -m "feat(pos): configured cart lines with modifier identity + required gating"
```

---

## Task 5: Materialization — flattenSaleLines (TDD) + wire into checkout

**Files:**
- Create: `lib/pos/modifier-lines.ts`
- Test: `lib/pos/__tests__/modifier-lines.test.ts`
- Modify: `lib/pos/sale-posting.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { flattenSaleLines } from '../modifier-lines';
import type { SaleLineInput } from '../pricing';

const base: SaleLineInput = { itemId: 'coffee', description: 'Coffee', quantity: 2, price: 20000, discountPct: 0 };

describe('flattenSaleLines', () => {
  it('emits a base line then a child line per priced/item-linked option', () => {
    const lines: SaleLineInput[] = [{ ...base, modifiers: [
      { groupId: 'milk', groupName: 'Milk', optionId: 'oat', optionName: 'Oat', priceDelta: 5000, itemId: 'oatItem' },
      { groupId: 'sz', groupName: 'Size', optionId: 'lg', optionName: 'Large', priceDelta: 3000, itemId: null },
    ] }];
    const out = flattenSaleLines(lines);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ lineNo: 1, itemId: 'coffee', isModifier: false, price: 20000, quantity: 2 });
    // base line price excludes deltas (deltas live on the child lines)
    expect(out[1]).toMatchObject({ lineNo: 2, parentLineNo: 1, isModifier: true, itemId: 'oatItem', price: 5000, quantity: 2, description: 'Oat' });
    expect(out[2]).toMatchObject({ lineNo: 3, parentLineNo: 1, isModifier: true, itemId: null, price: 3000, quantity: 2, description: 'Large' });
  });

  it('records free ($0, no item) options as modifierNote on the base line, no child line', () => {
    const lines: SaleLineInput[] = [{ ...base, modifiers: [
      { groupId: 'sugar', groupName: 'Sugar', optionId: 'no', optionName: 'No sugar', priceDelta: 0, itemId: null },
    ] }];
    const out = flattenSaleLines(lines);
    expect(out).toHaveLength(1);
    expect(out[0].modifierNote).toBe('No sugar');
  });

  it('passes the base line price through unchanged (base price is item base, not base+deltas)', () => {
    // caller must send the base line price WITHOUT deltas; the cart stores base+delta
    // on CartLine.price, so sale-posting subtracts deltas before flattening (see wiring).
    const out = flattenSaleLines([{ ...base, modifiers: [] }]);
    expect(out).toEqual([{ lineNo: 1, parentLineNo: null, isModifier: false, itemId: 'coffee', description: 'Coffee', quantity: 2, price: 20000, discountPct: 0, performedById: null, modifierNote: null }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/pos/__tests__/modifier-lines.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { SaleLineInput } from './pricing';

export interface MaterializedLine {
  lineNo: number;
  parentLineNo: number | null;
  isModifier: boolean;
  itemId: string | null;
  description: string;
  quantity: number;
  price: number;
  discountPct: number;
  performedById: string | null;
  modifierNote: string | null;
}

/**
 * Flatten configured POS cart lines into SalesInvoiceLine-shaped rows:
 *  - one base line per input line (price = the item base, deltas NOT included);
 *  - one child line per selected option that has priceDelta != 0 OR an itemId
 *    (parentLineNo → base lineNo, isModifier true, price = priceDelta, qty = base qty);
 *  - free options ($0, no item) become a comma-joined modifierNote on the base line.
 * Child-line itemId drives stock+COGS via the existing postInvoiceSend engine.
 */
export function flattenSaleLines(lines: SaleLineInput[]): MaterializedLine[] {
  const out: MaterializedLine[] = [];
  let lineNo = 0;
  for (const l of lines) {
    const mods = l.modifiers ?? [];
    const freeNotes = mods.filter((m) => m.priceDelta === 0 && !m.itemId).map((m) => m.optionName);
    const baseNo = ++lineNo;
    out.push({
      lineNo: baseNo,
      parentLineNo: null,
      isModifier: false,
      itemId: l.itemId,
      description: l.description,
      quantity: l.quantity,
      price: l.price,
      discountPct: l.discountPct ?? 0,
      performedById: l.performedById ?? null,
      modifierNote: freeNotes.length ? freeNotes.join(', ') : null,
    });
    for (const m of mods) {
      if (m.priceDelta === 0 && !m.itemId) continue; // free → note only
      out.push({
        lineNo: ++lineNo,
        parentLineNo: baseNo,
        isModifier: true,
        itemId: m.itemId ?? null,
        description: m.optionName,
        quantity: l.quantity,
        price: m.priceDelta,
        discountPct: 0,
        performedById: l.performedById ?? null,
        modifierNote: null,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/pos/__tests__/modifier-lines.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `lib/pos/sale-posting.ts`.** The cart sends each base line's `price` as base+Σdeltas (from `CartLine.price`). Before using lines, normalize: subtract the option deltas from the base price, then flatten. Replace the direct use of `input.lines` in steps 4/6:

At the top of `postPosSale`, after computing `totals` is fine, but do the transform up front so FEFO + create + totals all see child lines. Insert after step 2 (register validation), before step 3:

```ts
  // 2b. Normalize configured lines: the cart's line.price = base + Σ priceDelta.
  //     Strip the deltas back out so the base line carries the item base and each
  //     option becomes its own materialized line.
  const normalized: SaleLineInput[] = input.lines.map((l) => {
    const delta = (l.modifiers ?? []).reduce((s, m) => s + m.priceDelta, 0);
    return { ...l, price: round2(l.price - delta) };
  });
  const materialized = flattenSaleLines(normalized);
```

Then:
- **Step 3 totals:** `const totals = computeSaleTotals(materialized, TAX_RATE);` (materialized lines already have `itemId`, `quantity`, `price`, `discountPct`).
- **Step 4 FEFO:** iterate `materialized` instead of `input.lines` (skip lines with `itemId == null`; a `!line.itemId` guard before the `item.findFirst`).
- **Step 6 create:** map `materialized` into `lines.create`, adding the new columns:

```ts
      lines: {
        create: materialized.map((l) => ({
          lineNo: l.lineNo,
          itemId: l.itemId ?? undefined,
          description: l.description,
          quantity: l.quantity,
          price: l.price,
          discountPct: l.discountPct,
          lineSubtotal: round2(l.quantity * l.price * (1 - l.discountPct / 100)),
          performedById: performerFor({ ...l, itemId: l.itemId ?? '', modifiers: undefined } as any),
          parentLineNo: l.parentLineNo,
          isModifier: l.isModifier,
          modifierNote: l.modifierNote,
        })),
      },
```

Note: `performerFor` currently keys on `performedById` only, so it works on materialized lines unchanged — simplify the call to `performerFor(l as unknown as SaleLineInput)`. Keep FEFO's `allocationsByLine` keyed by `itemId` (child item-linked lines correctly draw their own stock).

Import `flattenSaleLines` at top: `import { flattenSaleLines, type MaterializedLine } from './modifier-lines';`

- [ ] **Step 6: Typecheck + unit run**

Run: `npx tsc --noEmit && npx vitest run lib/pos`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/pos/modifier-lines.ts lib/pos/__tests__/modifier-lines.test.ts lib/pos/sale-posting.ts
git commit -m "feat(pos): materialize modifiers as child SalesInvoiceLines at checkout"
```

---

## Task 6: modifier-groups CRUD API

**Files:**
- Create: `src/app/api/v1/modifier-groups/route.ts`
- Create: `src/app/api/v1/modifier-groups/[id]/route.ts`

**Pattern to mirror:** `src/app/api/v1/departments/route.ts` (GET list + POST) and its `[id]/route.ts` (GET/PUT/DELETE). Use `withHandler` + manual `x-org-id` check like departments, OR `withPermission({ module: 'POS_RETAIL', action })`. Use `withPermission` here for consistency with other POS routes.

- [ ] **Step 1: Implement `route.ts`** — `GET` lists groups for the org (`prisma.modifierGroup.findMany` with `include: { options: true, _count: { select: { attachments: true } } }`, `orderBy: { sortOrder: 'asc' }`), `POST` validates with `modifierGroupInputSchema`, creates the group with nested `options: { create: parsed.options }`, then `logAudit`. Guard both with `withPermission({ module: 'POS_RETAIL', action: 'view' | 'create' })`. `export const runtime = 'nodejs';` and an `OPTIONS` handler returning `corsPreflightResponse()`.

- [ ] **Step 2: Implement `[id]/route.ts`** — `GET` one (include options + attachments), `PUT` updates scalar fields and replaces options (delete-then-recreate inside `prisma.$transaction`: `deleteMany({ where: { groupId } })` then `create`), `DELETE` removes the group (cascade drops options + attachments). Each verifies the group's `organizationId === x-org-id` (404 otherwise). `logAudit` on PUT/DELETE.

- [ ] **Step 3: Manual smoke** (dev server running)

Run: `curl -s -X POST localhost:3000/api/v1/modifier-groups -H 'content-type: application/json' -H 'x-org-id: <org>' -H 'x-user-id: <user>' -d '{"organizationId":"<org>","name":"Milk","selectionType":"SINGLE","isRequired":true,"options":[{"name":"Oat","priceDelta":5000}]}'`
Expected: `200/201` JSON with the created group + one option.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/modifier-groups
git commit -m "feat(pos): modifier-groups CRUD API"
```

---

## Task 7: modifier-attachments API

**Files:**
- Create: `src/app/api/v1/modifier-attachments/route.ts`
- Create: `src/app/api/v1/modifier-attachments/[id]/route.ts`

**Pattern to mirror:** same as Task 6.

- [ ] **Step 1: Implement `route.ts`** — `GET` lists attachments for the org (optionally filter by `?groupId=` / `?itemId=` / `?itemCategoryId=`), `include: { group: { select: { name: true } }, item: { select: { name: true } }, itemCategory: { select: { name: true } } }`. `POST` validates with `modifierAttachmentInputSchema` (the `.refine` enforces exactly one target), verifies the group belongs to the org, creates the attachment, `logAudit`. Guard with `withPermission({ module: 'POS_RETAIL', action })`.

- [ ] **Step 2: Implement `[id]/route.ts`** — `DELETE` only (attachments are create/delete, not editable); verify org ownership; `logAudit`.

- [ ] **Step 3: Manual smoke**

Run: `curl -s -X POST localhost:3000/api/v1/modifier-attachments -H 'content-type: application/json' -H 'x-org-id: <org>' -H 'x-user-id: <user>' -d '{"organizationId":"<org>","groupId":"<grp>","itemCategoryId":"<cat>"}'`
Expected: `200/201` with the created attachment.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/modifier-attachments
git commit -m "feat(pos): modifier-attachments API"
```

---

## Task 8: Extend catalog to serve resolved modifiers (TDD integration)

**Files:**
- Modify: `src/app/api/v1/pos/catalog/route.ts`
- Test: `lib/__tests__/integration/pos-modifiers.int.test.ts` (create; the catalog part)

- [ ] **Step 1: Write the failing integration test** — seed an org with a category `Coffee`, an item `Latte` in it, a group `Milk` (SINGLE, required) attached to the category with two options (one item-linked `oatItem`, one price-only), then call the catalog handler and assert the `Latte` entry carries a `modifierGroups` array with the resolved group + options in order. (Follow the seeding style in existing `lib/__tests__/integration/*.int.test.ts`, e.g. `pos-isolation.int.test.ts`.)

```ts
// key assertion
const latte = body.find((i: any) => i.id === latteId);
expect(latte.modifierGroups).toHaveLength(1);
expect(latte.modifierGroups[0]).toMatchObject({ id: milkId, selectionType: 'SINGLE', isRequired: true });
expect(latte.modifierGroups[0].options.map((o: any) => o.name)).toEqual(['Oat', 'Regular']); // sortOrder
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run -c vitest.integration.config.ts lib/__tests__/integration/pos-modifiers.int.test.ts`
Expected: FAIL — `latte.modifierGroups` undefined.

- [ ] **Step 3: Implement.** In the catalog route, after loading `items`, also load the org's groups with options + attachments:

```ts
import { resolveItemGroups, type GroupWithAttach } from '@/lib/pos/modifier-resolution';

const groups = await prisma.modifierGroup.findMany({
  where: { organizationId: orgId, isActive: true },
  include: { options: true, attachments: { select: { itemId: true, itemCategoryId: true } } },
});
const groupData: GroupWithAttach[] = groups.map((g) => ({
  id: g.id, name: g.name, selectionType: g.selectionType, isRequired: g.isRequired,
  sortOrder: g.sortOrder, isActive: g.isActive,
  options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.priceDelta), itemId: o.itemId, sortOrder: o.sortOrder, isActive: o.isActive })),
  attachedItemIds: g.attachments.filter((a) => a.itemId).map((a) => a.itemId!),
  attachedCategoryIds: g.attachments.filter((a) => a.itemCategoryId).map((a) => a.itemCategoryId!),
}));
```

The item query must also `select` `categoryId`. Then in the returned map:

```ts
return ok(items.map((it) => ({
  ...it,
  sellingPrice: Number(it.sellingPrice),
  qtyAvailable: stockByItem.get(it.id) ?? 0,
  earliestExpiry: expiryByItem.get(it.id)?.toISOString() ?? null,
  modifierGroups: resolveItemGroups(groupData, { itemId: it.id, categoryId: it.categoryId ?? null }),
})));
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run -c vitest.integration.config.ts lib/__tests__/integration/pos-modifiers.int.test.ts`
Expected: PASS (catalog test).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/pos/catalog/route.ts lib/__tests__/integration/pos-modifiers.int.test.ts
git commit -m "feat(pos): catalog serves resolved modifier groups per item"
```

---

## Task 9: Back-office settings screen

**Files:**
- Create: `src/views/settings/ModifierSettings.tsx`
- Modify: wherever POS settings routes/tabs are registered (grep for `ModifierSettings` sibling, e.g. the settings router that renders `Outlet POS`/registers screens).

**Pattern to mirror:** an existing settings CRUD list view (e.g. the registers screen or a categories screen) using React Query hooks against the new endpoints.

- [ ] **Step 1: Build the screen** — three panels: (1) **Groups** list with create/edit (name, SINGLE/MULTI toggle, required toggle, sortOrder, active) and nested **Options** editor (name, priceDelta, optional Item picker, active); (2) **Attachments** — attach a selected group to an Item or an Item Category (two-mode picker enforcing exactly one). Use React Query mutations hitting `/api/v1/modifier-groups` and `/api/v1/modifier-attachments`. Labels in Indonesian to match the app (e.g. "Modifier", "Grup", "Pilihan", "Wajib dipilih", "Pilih satu / Pilih banyak", "Terapkan ke Barang / Kategori").

- [ ] **Step 2: Register the screen** in the settings navigation next to the other Kasir settings; gate visibility with the `POS_RETAIL` permission.

- [ ] **Step 3: Manual verify** — open the settings screen, create a "Milk" group with Oat (+5000, linked to an item) and Regular (0), attach it to the Coffee category, reload. Confirm persistence.

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/ModifierSettings.tsx <settings-router-file>
git commit -m "feat(pos): modifier settings admin screen"
```

---

## Task 10: Register selection modal + cart/receipt display

**Files:**
- Create: `src/pos/components/ModifierModal.tsx`
- Modify: `src/pos/components/ProductTile.tsx` (open modal when item has groups), `src/pos/components/CartLines.tsx` (render indented options + use `line.key`), `src/pos/hooks/usePos.ts` + `src/pos/hooks/useOfflinePos.ts` (thread `addConfiguredItem`), `src/pos/offline/db.ts` (cache `modifierGroups` in the offline catalog), `src/pos/views/ReceiptView.tsx` (print options under the parent line).

- [ ] **Step 1: Build `ModifierModal.tsx`** — props: `item` (with `modifierGroups`), `onConfirm(mods: SelectedModifier[])`, `onCancel`. Render each group: SINGLE → radio list, MULTI → checkboxes; show `priceDelta` next to each option (hide if 0); mark required groups. Track selections in local state; disable Confirm until `requiredGroupsSatisfied(groups, selected)` is true. On confirm, emit the `SelectedModifier[]`.

- [ ] **Step 2: Wire the tile** — in `ProductTile`/`ProductGrid`, if `item.modifierGroups?.length` open `ModifierModal`; on confirm call `addConfiguredItem(cart, item, mods)`. If no groups, keep the current `addItem` fast path.

- [ ] **Step 3: Cart + receipt display** — in `CartLines.tsx` render `line.modifiers` as indented sub-rows (name + delta) and `line.modifierNote` as a muted note; switch qty/discount/remove handlers to `line.key`. Mirror in `ReceiptView.tsx`.

- [ ] **Step 4: Offline cache** — ensure `src/pos/offline/db.ts` stores and returns `modifierGroups` on catalog items so configuration works offline; the sale payload (`toSaleLines`) already carries `modifiers`, and `postPosSale` materializes them on sync (Task 5) — no extra sync code.

- [ ] **Step 5: Manual verify (online + offline)** — tap Coffee → pick Oat milk + tick a free option → line shows "Coffee / Oat milk +5.000 / (No sugar)" at 25.000; checkout; open the created `POS-####` invoice and confirm a base line + an oat-milk child line (`isModifier`, `parentLineNo`), stock for the oat item decremented, and the receipt lists options. Repeat with the network throttled offline, then sync.

- [ ] **Step 6: Commit**

```bash
git add src/pos/components/ModifierModal.tsx src/pos/components/ProductTile.tsx src/pos/components/CartLines.tsx src/pos/hooks src/pos/offline/db.ts src/pos/views/ReceiptView.tsx
git commit -m "feat(pos): modifier selection modal + cart/receipt display + offline"
```

---

## Task 11: End-to-end checkout integration test

**Files:**
- Modify: `lib/__tests__/integration/pos-modifiers.int.test.ts` (add the checkout case)

- [ ] **Step 1: Write the test** — seed org + register + open shift + walk-in customer + COA defaults (reuse the setup from `pos-isolation.int.test.ts`). Create a base item `Coffee` (priced) and an inventory item `OatMilk` with a stock batch. Call `postPosSale` inside a `$transaction` with one line: Coffee ×2 with modifiers `[oat(+5000, itemId=oatItem), large(+3000,null), noSugar(0,null)]`, tendering enough cash. Assert:

```ts
const inv = await prisma.salesInvoice.findUnique({ where: { id: res.salesInvoiceId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
expect(inv!.lines).toHaveLength(3);                         // base + oat + large (noSugar is a note)
expect(inv!.lines[0]).toMatchObject({ isModifier: false, modifierNote: 'No sugar' });
expect(inv!.lines[1]).toMatchObject({ isModifier: true, parentLineNo: 1, itemId: oatItemId, quantity: 2 });
// stock drawn for the oat item
const batch = await prisma.stockBatch.findUnique({ where: { id: oatBatchId } });
expect(Number(batch!.qtyOnHand)).toBe(initialQty - 2);
// GL balanced across posted journal lines for this invoice
const jlSum = /* sum debits - credits over the sale's journal entries */;
expect(jlSum).toBe(0);
```

- [ ] **Step 2: Run**

Run: `npx vitest run -c vitest.integration.config.ts lib/__tests__/integration/pos-modifiers.int.test.ts`
Expected: PASS (catalog + checkout cases).

- [ ] **Step 3: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green (no regressions in cart/pricing/sale-posting tests).

- [ ] **Step 4: Commit**

```bash
git add lib/__tests__/integration/pos-modifiers.int.test.ts
git commit -m "test(pos): end-to-end modifier checkout — child lines, stock, balanced GL"
```

---

## Self-Review Notes

- **Spec coverage:** master data (Task 1), required/optional + single/multi rules (Tasks 1–4, 10), price-only vs item-linked options (Tasks 1, 5, 11), item ∪ category resolution (Tasks 3, 8), child-line materialization + reuse of existing stock/COGS posting (Tasks 5, 11), settings UI (Task 9), register UI + cart/receipt + offline (Task 10), testing (Tasks 3,4,5,8,11). All spec sections mapped.
- **Deviation from spec:** RBAC reuses the existing `POS_RETAIL` ModuleKey instead of a new `pos_modifiers` module, to avoid Prisma enum migration + role-seed churn (YAGNI). If a separate permission is later wanted, add the enum value + seed rows and swap the `withPermission` module string.
- **Naming consistency:** `resolveItemGroups`, `flattenSaleLines`, `addConfiguredItem`, `lineKey`, `requiredGroupsSatisfied`, `SelectedModifier`, `MaterializedLine`, `GroupWithAttach` used consistently across tasks. Cart functions re-keyed from `itemId` → `key` everywhere (Task 4 Step 4 updates callers).
- **Ordering caveat:** Task 4 changes the signatures of `setQty`/`setDiscount`/`removeLine` (itemId → key). Task 10 consumers already use `line.key`; the Task 4 caller sweep (Step 4) covers current callers so the tree typechecks between tasks.
