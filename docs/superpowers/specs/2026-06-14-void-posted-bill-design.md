# Void a posted Bill — design

Status: approved 2026-06-14. Branch: `fix/posting-integrity`.

## Problem

There is no way to undo a posted vendor bill. Once a bill goes DRAFT→OPEN it
posts to the GL (and possibly inventory) and can never be reversed: PUT rejects
non-DRAFT edits, DELETE only allows DRAFT. A mistaken posting is permanent.

## Goal

Add a **void** flow for a posted Bill that reverses its accounting cleanly:
reverse the posting journal entry, unwind any inventory it booked directly, and
mark the bill VOID. Out of scope (not selected): un-receiving goods receipts,
voiding payments.

## Foundation: `reverseJournalEntry`

New primitive in `lib/journal-posting.ts`:

```ts
reverseJournalEntry(tx, originalJeId, { date: Date; memo: string }): Promise<{ id; entryNo }>
```

- Loads the original `JournalEntry` + lines.
- Posts a fresh balanced entry with each line's debit/credit **swapped**
  (positive amounts — the codebase idiom; never negative lines).
- `source: 'REVERSAL'`. Widen `PostJournalEntryArgs.source` to include
  `'REVERSAL'` (the `JournalSource` DB enum already has it; never used until now).
- Throws if the original entry is missing.

## Schema changes (needs `prisma db push` at merge)

On `Bill`:
- `journalEntryId String?` — the posting JE, so void knows what to reverse.
- `voidedAt DateTime?` — set when voided (also the double-void guard).

`postBillToLedger` is changed to capture the posted JE id and write it onto the
bill (`tx.bill.update`). Callers unchanged.

## Void service: `lib/bill-void.ts`

```ts
voidBill(tx, orgId, billId, { date: Date }): Promise<void>
```

Guards (throw `ApiError`):
- bill exists, not deleted;
- status ∈ {OPEN, PENDING, OVERDUE} (posted). DRAFT → 422 "delete instead";
  already VOID → 422.
- no settlement: `status !== 'PAID'` and no `paymentAllocations` → else 422
  "void/unallocate payments first".
- `assertPeriodOpen(tx, orgId, date)` — reversal dated **today** (the void date).

Actions (one transaction):
1. `reverseJournalEntry(tx, bill.journalEntryId, { date, memo: 'Void bill: <number>' })`.
   If `journalEntryId` is null (legacy bill posted before this change), fall back
   to locating the entry by memo `Bill: <number>`; if still none, 422.
2. Inventory: **only when `bill.poId == null`** — remove the PURCHASE cost layers
   created by this bill (`documentType=PURCHASE, documentId=bill.id`) via a new
   `reversePurchaseLayers` helper. PO-sourced bills never touch inventory (the
   layer belongs to the goods receipt).
3. `tx.bill.update`: `status='VOID'`, `voidedAt=now`.

### `reversePurchaseLayers(tx, orgId, documentId)` (in `lib/inventory-costing.ts`)

- Finds `InventoryLot` rows for `(orgId, PURCHASE, documentId)`.
- For each: assert **unconsumed** — `qtyBalance ≈ qtyIn` (epsilon). If any has
  been drawn down → throw `ApiError(422)` "inventory already consumed/sold;
  cannot void".
- Removes the layer (delete) and appends a contra `InventoryLedgerEntry`
  (`qtyOut = qtyIn`, negative `valueChange`) for the audit trail.

## API + UI

- `POST /api/v1/bills/[id]/void` — action route mirroring PO `approve`/`close`.
  Returns the voided bill. Period/ApiError → mapped status by `withHandler`.
- `useVoidBill()` React Query hook in `src/hooks/useAP.ts` (invalidates bills).
- A "Void" action in the bill view, shown only for posted bills.

## Testing (TDD)

- `reverseJournalEntry`: swaps sides; balanced; source REVERSAL; missing-entry throws.
- `postBillToLedger`: writes `journalEntryId` onto the bill.
- `reversePurchaseLayers`: removes unconsumed layer + contra ledger; throws on consumed.
- `voidBill`: reverses GL; non-PO inventory bill removes layer; PO bill leaves
  inventory; blocks DRAFT / already-VOID / PAID / closed-period.
- Route: happy path 200 + sets VOID; guards return 422.

## Non-goals / deferred

- Un-receiving goods receipts; payment void (DELETE still orphans payment JEs).
- Reversing a void (re-open). VOID is terminal.
- GR bills whose qty was edited (residual GR/IR) — separate receipt-reversal work.
