# Perpetual Inventory at Goods Receipt (GR/IR Clearing) — Design

**Date:** 2026-06-12
**Status:** Approved (design), pending implementation plan
**Area:** Accounts Payable / Inventory / General Ledger

## Problem

Today, inventory stock and its General Ledger value are only recognized when a
bill is **created directly** with status `OPEN` (the `POST /api/v1/bills` path).
The purchase-order receiving flow (`POST /api/v1/purchase-orders/[id]/receive`)
creates a **DRAFT** bill and posts nothing. The draft→`OPEN` transition used by
the UI (`PUT /api/v1/bills/[id]`, triggered by "Mark as Unpaid") also posts
nothing to inventory or the GL.

Consequences:

1. Goods physically received are not reflected in inventory on-hand or the
   balance sheet until someone manually creates/opens a bill.
2. The receive→draft→open path can leave a bill in AP aging (`OPEN`) with **no**
   inventory movement and **no** journal entry at all — a correctness gap.
3. At period boundaries (goods received in December, supplier faktur arrives in
   January), inventory and payables land in the wrong accounting period.

## Goal

Recognize inventory **and** the corresponding liability when goods are
physically received, using a **GR/IR (Goods Received / Invoice Received)
clearing account** — the standard ERP treatment. The supplier bill later clears
GR/IR into Accounts Payable. Net GL effect across both events is unchanged
(`Dr Inventory / Cr AP`); only the *timing* of recognition moves earlier, to the
receipt event.

Tax (PPN Masukan / input tax) stays on the bill, because no tax invoice (faktur)
exists at receipt time.

## Accounting model

Example: receive Rp 10,000,000 of stock; supplier invoice adds 11% PPN.

| Event | Journal |
|---|---|
| **Receipt** (`/receive`) | `Dr Inventory 10,000,000` · `Cr GR/IR clearing 10,000,000` |
| **Bill finalized** (DRAFT→OPEN, or direct-OPEN create) | `Dr GR/IR clearing 10,000,000` · `Dr Input Tax (PPN) 1,100,000` · `Cr Accounts Payable 11,100,000` |

GR/IR nets to zero once the goods are invoiced. Until then it carries the
"received but not yet invoiced" liability — visible on the balance sheet in the
correct period.

Only **inventory lines** (item `type` of `PRODUCT` or `RAW_MATERIAL`) post at
receipt. Service/freight/non-inventory lines are **not** touched at receipt;
they are expensed when the bill is finalized.

## Tax treatment (VAT / PPN)

Indonesian reality: some vendors are non-PKP and issue **no VAT**; some prices
are **VAT-inclusive**, others **VAT-exclusive**. The reference system (Accurate
Online) models this on the purchase document with two checkboxes under *Info
Pajak* — **"Kena Pajak"** (taxable) and **"Total termasuk Pajak"** (total
includes tax). We mirror that exactly.

**Two document-level flags on PurchaseOrder and Bill:**

- `taxable` (Boolean) — "Kena Pajak". Whether PPN applies at all. `false` =
  non-PKP / no faktur → no input tax recognized.
- `taxInclusive` (Boolean) — "Total termasuk Pajak". Whether line prices already
  contain PPN.

Defaults: seed `taxable` from `Vendor.isPkp` and `taxInclusive` from the org's
`taxInclusiveByDefault`; both editable per document.

**Invariant: inventory is always valued at *net* cost (excluding recoverable
PPN). GR/IR carries that same net value, so it nets to zero regardless of tax
treatment.** The three cases:

| `taxable` | `taxInclusive` | Net cost basis (Dr Inventory / Cr GR/IR) | Input tax (Dr at bill) |
|---|---|---|---|
| false | — | line `price × qty` (full) | none |
| true | false | line `price × qty` | subtotal × rate, added on top |
| true | true | `(price × qty) ÷ (1 + rate)` (net) | total − net (embedded) |

The unit cost written to the inventory cost layer is the **net** unit cost
derived per the table — for VAT-inclusive purchases that is `price ÷ (1 + rate)`,
**not** the displayed gross price. Sub-rupiah deltas from inclusive division use
the existing `roundingAccount` default.

Self-consistency: the receipt and the bill both derive inventory/GR/IR from the
**same persisted (net) bill-line values**, so GR/IR always clears to zero even
when rounding occurs.

## Decisions (confirmed)

- **VAT treatment:** two document flags `taxable` (Kena Pajak) + `taxInclusive`
  (Total termasuk Pajak) on PO and Bill, mirroring Accurate Online. Inventory
  valued at net cost; input tax recognized only when `taxable`, on the bill.

- **GL model:** GR/IR clearing account (vs. stock-only-at-receipt, vs.
  goods-in-transit asset). Chosen for accrual correctness; subledger and GL
  always agree.
- **GR/IR account setup:** auto-created on first use. An idempotent
  `ensureGrIrAccount(tx, orgId)` creates a Liability account (code ~`2150`,
  name "Goods Received Not Invoiced" / "Penerimaan Barang Belum Tertagih") if
  the org has none. User may rename/remap later via Settings → account-defaults.
  Receiving is never blocked on configuration.
- **Scope:** core receipt→GR/IR→bill posting only. Receipt reversal and a GR/IR
  aging report are **follow-ups** (see Out of Scope).

## Components

### 1. Account default: `grIrClearing`

`lib/account-defaults.ts` — add a new entry to `ACCOUNT_DEFAULT_SPECS`:

```
grIrClearing: {
  label: 'Goods Received Not Invoiced (GR/IR)',
  description: 'Clearing liability for goods received but not yet invoiced.',
  allowedTypes: ['Liability'],
  preferredCodes: ['2150', '215'],
  keywords: ['penerimaan barang belum tertagih', 'goods received not invoiced',
             'grir', 'gr ir', 'uninvoiced receipts', 'akrual pembelian'],
}
```

This automatically surfaces the new role in the Settings account-defaults
picker (that UI iterates `ACCOUNT_DEFAULT_SPECS`). No `preferredIds`, and the
posting code does **not** rely on the generic `candidates[0]` fallback for this
role — see `ensureGrIrAccount`.

### 2. `ensureGrIrAccount(tx, orgId)` helper

New helper (e.g. `lib/grir.ts`). Resolution order:

1. Org-configured `grIrClearing` default, if it resolves to a usable Liability
   account → use it.
2. Otherwise, find an existing Liability account matching the preferred
   codes/keywords → use it.
3. Otherwise, **create** a Liability account (code `2150`, name "Goods Received
   Not Invoiced", `isPostable: true`, `isActive: true`) and return it.

Idempotent: a second call returns the same account (lookup-before-create,
guarded against the unique `(organizationId, code)` constraint). Returns the
account id used for GR/IR postings.

### 3. Receipt posting — `POST /api/v1/purchase-orders/[id]/receive`

Within the existing `$transaction`, after the draft bill is created,
`receivedQty` incremented, and PO status updated:

- Resolve org `costingMethod`; resolve `inventoryAsset` account and
  `ensureGrIrAccount`.
- Identify inventory lines among the received lines (item `type` PRODUCT /
  RAW_MATERIAL).
- For each inventory line: `addCostLayer(tx, orgId, itemId, null, qty,
  netUnitCost, InventoryDocumentType.PURCHASE, bill.id, receiptDate)` — stock-in
  at the **net** unit cost (see Tax treatment: for VAT-inclusive POs this is
  `price ÷ (1 + rate)`, otherwise `price`). `bill.id` is the document reference
  (the draft bill is the receipt's artifact).
- The receive route must populate the draft bill's `taxable`, `taxInclusive`,
  `taxRate`, `subtotal` (net), `taxAmount`, and `totalAmount` from the PO's tax
  treatment — it currently hardcodes `taxAmount: 0`, which is wrong for
  taxable/inclusive POs.
- Post one balanced journal entry via `postJournalEntry`:
  `Dr Inventory (Σ inventory goods value)` · `Cr GR/IR (same)`.
  Memo: `Goods receipt: PO <number>`.
- Non-inventory lines: no posting at receipt.
- If there are no inventory lines, post nothing (service-only receipt is a
  no-op at the GL until billed).

### 4. Bill posting — shared `postBill` helper, two callers

Extract the inventory + journal logic currently inline in `POST /bills`
(lib step) into a shared helper, e.g. `postBillToLedger(tx, orgId, bill)` in
`lib/bills.ts`. Per-line rules:

| Line | Cost layer | GL debit |
|---|---|---|
| Inventory line **with** `purchaseOrderLineId` (already received) | **none** (added at receipt) | `Dr GR/IR clearing` |
| Inventory line **without** PO link (manual stock bill) | add cost layer | `Dr Inventory` (legacy) |
| Service / non-inventory line | n/a | `Dr Expense` |

Plus `Dr Input Tax` for tax, `Cr Accounts Payable` for total — unchanged. The
"with PO link" branch is the GR/IR clearing path; everything else is today's
behavior, so **manual non-PO bills are unaffected**.

Callers:

- **`POST /api/v1/bills`** when created with `OPEN`/`APPROVED` — replace the
  current inline block with `postBillToLedger`.
- **`PUT /api/v1/bills/[id]`** when status transitions `DRAFT`→`OPEN` — currently
  posts nothing; call `postBillToLedger`. Guard so it posts exactly once (only on
  the DRAFT→OPEN edge, not on every save of an already-open bill — though note
  the PUT route currently rejects edits to non-DRAFT bills, so the transition is
  the only posting trigger).

### 5. Preserve `purchaseOrderLineId` on draft-bill edits

`PUT /api/v1/bills/[id]` rebuilds bill lines via `deleteMany` + `createMany` and
currently **drops** `purchaseOrderLineId`. Fix: carry `purchaseOrderLineId`
through the rebuild so the GR/IR-clearing branch still recognizes received
lines after a draft is edited. (The inbound update schema may need the field;
include it.)

## Data flow

```
PO (APPROVED)
  └─ POST /receive
       ├─ create DRAFT bill (received lines, linked via purchaseOrderLineId)
       ├─ increment receivedQty, update PO status
       ├─ addCostLayer (inventory lines)           ← stock in
       └─ postJournalEntry  Dr Inventory / Cr GR/IR ← asset + liability recognized

DRAFT bill ── "Mark as Unpaid" (PUT status OPEN)
  └─ postBillToLedger
       ├─ inventory+PO lines → Dr GR/IR (no cost layer)  ← clears liability
       ├─ service lines      → Dr Expense
       ├─ tax                → Dr Input Tax
       └─ total              → Cr Accounts Payable
```

## Edge cases

- **Partial receipt:** only received qty posts to inventory + GR/IR; each
  receipt spawns its own draft bill (already the case). Received-but-unbilled
  goods correctly sit in GR/IR until invoiced.
- **PO closed with partial receipt:** GR/IR retains the received-but-unbilled
  balance; correct.
- **Draft bill edited before opening:** `purchaseOrderLineId` preserved
  (component 5), so GR/IR clearing still applies.
- **No inventory lines on a receipt:** GL no-op at receipt.
- **GR/IR account missing:** never happens at posting time —
  `ensureGrIrAccount` creates it.
- **Mixed bill** (some lines received via PO, some manual inventory lines):
  per-line rules handle each independently.

## Out of scope (follow-ups)

- Reversing/undoing a goods receipt (reverse cost layer + GL).
- GR/IR aging report ("received but not invoiced" by PO/vendor).
- Voiding a posted bill and unwinding GR/IR.
- **Document action bar** (separate spec): a reusable toolbar across all
  transaction forms mirroring Accurate's right-side buttons — Save, Print,
  Attachments & Comments, History/Activity log (over existing `logAudit` data),
  Delete. Cross-cutting UI; deferred until GR/IR lands.

## Testing

Integration tests (Vitest, alongside existing `ap.validation.test.ts`):

1. Receipt posts `Dr Inventory / Cr GR/IR` for inventory lines + creates cost
   layer; service lines untouched.
2. Bill finalize (DRAFT→OPEN) for a received PO posts `Dr GR/IR + Dr Input Tax /
   Cr AP` and adds **no** duplicate cost layer.
3. Receipt + bill net to a balanced `Dr Inventory / Cr AP`; GR/IR balance returns
   to zero.
4. Partial receipt: only received qty hits inventory + GR/IR.
5. Manual non-PO inventory bill (direct `OPEN` create) still posts
   `Dr Inventory` + cost layer — legacy path unchanged.
6. `ensureGrIrAccount` is idempotent and auto-creates when absent.
7. Draft-bill edit preserves `purchaseOrderLineId`.
8. **VAT — non-PKP** (`taxable=false`): inventory = full price, no input-tax
   line, GR/IR = full price, clears to zero.
9. **VAT — exclusive** (`taxable=true, taxInclusive=false`): inventory = net,
   bill adds `Dr Input Tax` on top, GR/IR = net, clears to zero.
10. **VAT — inclusive** (`taxable=true, taxInclusive=true`): inventory =
    `price ÷ (1+rate)`, embedded tax recognized on bill, GR/IR = net, clears to
    zero; rounding delta (if any) lands in `roundingAccount`.

## Affected files

- `prisma/schema.prisma` — add `taxable Boolean @default(false)` and
  `taxInclusive Boolean @default(false)` to `PurchaseOrder` and `Bill` (additive
  migration; note the concurrent opening-balance work also edits this file).
- `lib/account-defaults.ts` — new `grIrClearing` spec.
- `lib/grir.ts` (new) — `ensureGrIrAccount`.
- `lib/bills.ts` — extract `postBillToLedger`; per-line GR/IR vs inventory rule;
  net-cost / input-tax computation honoring `taxable` + `taxInclusive`.
- `src/app/api/v1/bills/route.ts` — call shared helper.
- `src/app/api/v1/bills/[id]/route.ts` — post on DRAFT→OPEN; preserve
  `purchaseOrderLineId`.
- `src/app/api/v1/purchase-orders/[id]/receive/route.ts` — net-cost cost layer +
  GR/IR journal at receipt; populate draft-bill tax fields from PO.
- Zod schemas (bill + PO input/update, under `@/types/api`) — carry `taxable`,
  `taxInclusive`, and `purchaseOrderLineId`.
- `src/views/ap/POForm.tsx` + `BillForm.tsx` — two "Info Pajak" checkboxes
  (Kena Pajak / Total termasuk Pajak), defaulting from vendor PKP + org setting.
- Tests under `src/app/api/v1/__tests__/`.
