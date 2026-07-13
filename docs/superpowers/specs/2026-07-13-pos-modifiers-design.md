# POS Modifiers — Design Spec

**Date:** 2026-07-13
**Status:** Approved (design)
**Module:** POS Front-of-House (Kasir) — Accurate POS parity, ROADMAP §A3
**Approach:** A (child lines) — see rationale below

## Summary

Add a general **modifier / option-group engine** to the POS so a cashier can attach
add-ons and options to a cart line at checkout. Serves both retail/F&B options
(size, milk, extra shot) and salon service add-ons (extra wash, long-hair surcharge).

Two option kinds:
1. **Price-only** — a label + price delta, revenue only, no stock movement.
2. **Item-linked** — points to a real `Item`, so selecting it draws stock and posts
   COGS through the existing per-line inventory/GL posting engine (no new GL code).

## Business rules (as agreed with user)

- **Option** = one choice with a name + `priceDelta` (tax-inclusive, may be 0) + optional `itemId`.
- **Group** = a named set of options with exactly two rules:
  - `isRequired` — cashier must choose (blocks add-to-cart until satisfied) vs optional.
  - `selectionType` — `SINGLE` (radio, pick one) vs `MULTI` (checkbox, pick many).
  - Explicitly **out of scope** (YAGNI, per user): min/max quantity, free-option allowance,
    per-option quantity (e.g. double shot as x2).
- **Attachment** = a group attaches to an individual `Item` **or** to an `ItemCategory`.
- **Resolution** at register: applicable groups for an item = groups attached to the Item
  **∪** groups attached to the Item's Category, deduped, ordered by `sortOrder`. Union only —
  no per-item suppression of an inherited group (add a suppress flag later only if needed).

## Approach A rationale

The system already auto-posts inventory depletion + COGS for any `SalesInvoiceLine` that
carries an `itemId` (see `lib/journal-posting.ts`, COGS on DRAFT→SENT). Representing each
priced/item-linked modifier as its **own child `SalesInvoiceLine`** means:
- Item-linked modifiers deplete stock + post COGS with **zero new posting code**.
- Revenue, inventory, and COGS reports capture modifiers automatically.
- Free ($0, no-item) options don't need a line — recorded as a note on the base line.

Rejected: embedded-JSON-on-line (Approach B) would require custom stock/COGS/reporting
logic that fights the accounting core. Analytics table (Approach C) deferred — add
`PosSaleLineModifier` later only if attach-rate reporting is wanted.

## Data model

### New models

**ModifierGroup** (org-scoped)
- `id`, `organizationId`
- `name` (unique per org)
- `selectionType`: enum `ModifierSelectionType { SINGLE | MULTI }`, default SINGLE
- `isRequired`: Boolean, default false
- `sortOrder`: Int, default 0
- `isActive`: Boolean, default true
- timestamps
- relations: `options ModifierOption[]`, `attachments ModifierAttachment[]`

**ModifierOption**
- `id`, `groupId`
- `name`
- `priceDelta`: Decimal(18,2), default 0 — tax-inclusive to match cart's tax-inclusive `price`
- `itemId`: String? — optional link to `Item` (stock + COGS when selected)
- `sortOrder`: Int, default 0
- `isActive`: Boolean, default true
- relations: `group` (cascade delete), `item Item?` (onDelete SetNull)

**ModifierAttachment** (group ↔ Item OR ItemCategory)
- `id`, `organizationId`, `groupId`
- `itemId`: String?
- `itemCategoryId`: String?
- relations: `group` (cascade), `item Item?` (cascade), `itemCategory ItemCategory?` (cascade)
- indexes on `[organizationId, itemId]` and `[organizationId, itemCategoryId]`
- exactly one of itemId / itemCategoryId is set (validated in the API layer)

### Changes to existing models

**SalesInvoiceLine** — add:
- `parentLineNo Int?` — the base line's `lineNo`; null for base/normal lines
- `isModifier Boolean @default(false)`
- `modifierNote String?` — structured note capturing free ($0, no-item) options on a base line

Back-relations added: `Item.modifierOptions`, `Item.modifierAttachments`,
`ItemCategory.modifierAttachments`, `Organization.modifierGroups`/`modifierAttachments`.

## Cart behavior (`src/pos/state/cart.ts`)

- `CartLine` gains `modifiers: SelectedModifier[]` where
  `SelectedModifier = { groupId, groupName, optionId, optionName, priceDelta, itemId? }`.
- **Line identity changes**: today lines merge on `itemId`. New key = `itemId` + a stable
  hash of the selected modifier set, so "Coffee + oat milk" stays separate from plain
  "Coffee", and two identical configured lines still merge (qty++).
- **Displayed unit price** = base `price` + Σ `priceDelta` of selected options.
- Add-to-cart is blocked in the UI until every `isRequired` group has a selection.

## Materialization to SalesInvoice (POS checkout → `src/app/api/v1/pos/sales`)

When a configured cart line is written to the `SalesInvoice`:
1. Base item → one `SalesInvoiceLine` (base line, `lineNo = N`).
2. Each selected option with `priceDelta != 0` **or** an `itemId` → its own child
   `SalesInvoiceLine`:
   - `parentLineNo = N`, `isModifier = true`
   - `itemId` set when the option is item-linked (→ stock + COGS via existing engine);
     null for price-only options (revenue-only line)
   - `description` = option name; `quantity` = base line quantity; `price` = `priceDelta`
3. Free options ($0, no item) → appended to the base line's `modifierNote` (for receipt),
   no separate line.

Child-line quantity tracks the parent quantity (2 coffees + oat milk ⇒ 2 oat-milk units).

## API surface (`src/app/api/v1/`)

Settings/master-data CRUD (follows existing route + `lib/api-utils.ts` conventions,
`logAudit()` on writes, RBAC-gated under a new `pos_modifiers` module permission):
- `modifier-groups` — GET/POST, `[id]` GET/PUT/DELETE (options managed nested or via sub-route)
- `modifier-groups/[id]/options` — manage options
- `modifier-attachments` — GET/POST/DELETE (attach a group to an item or category)

POS read path:
- Extend `pos/catalog` so each catalog item includes its resolved modifier groups+options
  (the SINGLE/MULTI/required rules + priced options), so the register can render the
  selection pop-up offline.

## UI

**Settings (back office):** a "Modifier" admin screen under POS settings — CRUD for groups,
their options (name, price, optional item link), and attachments (to item or category).
Mirrors Accurate's Kasir → Modifier tile. Follows existing catalog/list-view pattern.

**Register (POS):** tapping a product that has required or optional groups opens a selection
modal — radios for SINGLE groups, checkboxes for MULTI, prices shown per option, required
groups marked. Confirming adds the configured line; the cart shows chosen options indented
under the product with the summed price. Receipt prints options under the parent line.

## Testing

- **Unit (cart):** line-identity hashing (configured vs plain don't merge; identical merge);
  required-group gating; price summation.
- **Unit (resolution):** item ∪ category group resolution, dedupe, ordering, inactive filtered.
- **Integration (checkout → invoice):** base + child lines created with correct
  `parentLineNo`/`isModifier`; item-linked option depletes stock + posts COGS and the GL
  stays balanced; price-only option posts revenue only; free option lands in `modifierNote`.
- **Offline:** catalog payload carries modifier data; a sale configured offline syncs and
  materializes child lines identically to online.

## Out of scope (this spec)

- Min/max selection counts, free-option allowances, per-option quantities.
- Modifier analytics / attach-rate reporting (`PosSaleLineModifier`) — future add.
- Per-item suppression of category-inherited groups.
- Salon scheduling/duration and staff commission (separate concerns; `priceDelta` covers upcharges).
