# Credit & Debit Note Void Reversal — Design

**Date:** 2026-06-24
**Status:** Approved (design)
**Scope:** Phase 1 of the **Void Integrity Program** (umbrella: `docs/superpowers/specs/2026-06-24-void-integrity-program-design.md`). Credit & debit notes only — AR/AP, no inventory, no migration. The systemic audit that expanded this into a 6-phase program lives in the program spec; sales/purchase returns are Phase 4, invoices Phase 3.

## Problem

Voiding an applied credit or debit note silently leaves its posting journal entry on the books.

In both `src/app/api/v1/credit-notes/[id]/route.ts` and `.../debit-notes/[id]/route.ts`, the `PUT` handler posts a journal entry on the `DRAFT → APPLIED` transition (via `postCreditNoteOnApply` / `postDebitNoteOnApply`) but handles `APPLIED → VOID` with the generic `update` only — it writes `status: 'VOID'` and **does not reverse the journal entry**. The status-only allow-list (`STATUS_ONLY_FIELDS`) explicitly permits this transition on a posted note, so the no-op is reachable from the UI.

Result: after voiding an applied note, the trial balance and the AR/AP subledger are overstated by the note amount. The general ledger no longer reflects reality.

For contrast, the sibling modules already reverse correctly:
- AP/AR payment void → `lib/payment-void.ts` calls `reverseJournalEntry`
- Bill void → `lib/bill-void.ts` calls `reverseJournalEntry`

The reusable storno helper `lib/reverse-journal-entry.ts` (posts a balanced `source: 'REVERSAL'` entry with debits/credits swapped) was simply never wired into the note void path.

## Goals

- Voiding an applied credit/debit note posts a reversing journal entry so the GL, trial balance, and AR/AP subledger return to their pre-apply state.
- Match the established bill/payment void pattern exactly (dedicated endpoint + `lib/*-void.ts` core + UI "Void" action with confirm dialog).
- Close the silent `PUT status:VOID` no-op so void can only happen through the reversing path.
- No schema migration.

## Non-Goals (Phase 2 fast-follow)

- Sales/purchase return void. Their journal entry **is** the inventory leg, so voiding must also unwind stock movements (remove the sales-return restock layer, blocking if already re-sold; un-consume the purchase-return FIFO draw-down). Higher risk; handled in a dedicated change with its own GL-invariant tests.

## Existing facts that shape the design

- Schema: `CreditNote` / `DebitNote` already have `status` (enum includes `VOID`), `journalEntryId` (`@unique`, used as the post-once idempotency token), and `postedAt`. **No `voidedAt` column** — and we will not add one (payments mark `status` only; we mirror that). → **no migration.**
- House void pattern: a dedicated `POST /api/v1/<entity>/[id]/void` route (`withHandler`, `requireOrg`, `prisma.$transaction`, `logAudit` action `VOID`) that calls a `lib/<entity>-void.ts` function. See `src/app/api/v1/bills/[id]/void/route.ts`.
- `reverseJournalEntry(tx, originalJeId, { date, memo })` posts the storno and returns the new entry; it does not guard against double-reversal — that is the document-level caller's job.
- `assertPeriodOpen(tx, orgId, date)` is the period guard used by bill/payment void.
- UI void pattern: list-view "Void" action button on posted rows → `useVoid*` hook → POST → confirm dialog. See `src/views/ap/Bills.tsx` (`handleVoid`) and `src/hooks/useAP.ts` (`useVoidBill`).

## Design

### 1. `lib/note-void.ts` — shared void core

Parallels `lib/payment-void.ts`: one private core + per-document config + two thin exports.

```
voidCreditNote(tx, orgId, id, { date }): Promise<void>
voidDebitNote(tx, orgId, id, { date }): Promise<void>
```

Core algorithm (per note):
1. Find the note: `{ id, number, status, journalEntryId }` scoped to `organizationId: orgId`.
2. Guards:
   - not found → `ApiError(404)`
   - `status === 'VOID'` → `ApiError('<label> is already voided', 422)`
   - `status !== 'APPLIED'` or `!journalEntryId` → `ApiError('<label> is not posted — delete the draft instead of voiding', 422)`
3. `await assertPeriodOpen(tx, orgId, date)`
4. `await reverseJournalEntry(tx, journalEntryId, { date, memo: 'Void <label>: <number>' })`
5. `update` the note to `status: 'VOID'`.

Notes:
- `journalEntryId` is **left set** (points at the original posting entry — audit trail). This keeps void terminal and is consistent with the existing PUT guard that already rejects any `* → DRAFT` transition, so the note can never be re-applied to produce a second posting.
- The reversal JE is `source: 'REVERSAL'`, dated at the void date, and not linked back onto the note row (same as bill/payment void; it is discoverable by memo).
- Labels: "credit note" / "debit note".

### 2. Void routes

- `POST /api/v1/credit-notes/[id]/void`
- `POST /api/v1/debit-notes/[id]/void`

Copied from `src/app/api/v1/bills/[id]/void/route.ts`: `withHandler` + `requireOrg` + `prisma.$transaction(voidCreditNote → re-fetch note)` + `logAudit({ entityType: 'CreditNote'|'DebitNote', action: 'VOID' })` + `ok(note)`. `date = new Date()` (void dated today, matching bill void).

### 3. Close the silent no-op in the PUT handlers

In both note `[id]/route.ts` PUT handlers, reject a `VOID` target:
- if `nextStatus === 'VOID'` → `ApiError('Void a posted note through POST /<entity>/:id/void', 422)`.

This removes the only way to reach the un-reversed status flip. (DRAFT notes that were never applied are still deleted via the existing DELETE path, unchanged.)

### 4. Frontend

- `src/hooks/useReturns.ts`: add `useVoidCreditNote()` / `useVoidDebitNote()` — `mutationFn: (id) => api.post('/api/v1/credit-notes/${id}/void')`, invalidating the credit/debit-note list + detail queries (and journal/GL queries if those keys are invalidated elsewhere on void). Remove the `Void` entry from the `CN_STATUS_UP` / `DN_STATUS_UP` maps used by the PUT-based `useUpdate*` path so the UI can no longer attempt a status-flip void.
- `src/views/ar/CreditNotes.tsx` and `src/views/ap/DebitNotes.tsx`: add a **"Void"** row action shown for `Applied` notes, calling the new hook behind a `window.confirm('Void this note? Its journal entry will be reversed. This cannot be undone.')`, mirroring `src/views/ap/Bills.tsx`.

## Testing (TDD — write tests first)

**Unit (vitest, mocked Prisma) — mirror `__tests__/ap-payment-void-route.test.ts` and the payment-void lib tests:**
- `lib/note-void`:
  - APPLIED note → calls `reverseJournalEntry` with the note's `journalEntryId` and sets `status: 'VOID'`.
  - already `VOID` → throws 422, no reversal.
  - DRAFT / missing `journalEntryId` → throws 422 ("delete the draft instead").
  - closed period → `assertPeriodOpen` rejects; no reversal, no status change.
- routes: `POST /void` calls `voidCreditNote`/`voidDebitNote` with a `date`; surfaces `ApiError` status codes; `PUT { status: 'VOID' }` now returns 422.

**Integration (`npm run test:int`, real Postgres) — extend the GL-invariant harness in `lib/__tests__/integration`:**
- Apply a credit note, capture trial balance + AR control balance, void it, then assert:
  - trial balance equals the pre-apply snapshot,
  - AR subledger / control restored,
  - note `status === 'VOID'`,
  - exactly two journal entries exist for the note (post + reversal) and they net to zero.
- Same scenario for a debit note against AP.

## Risks & mitigations

- **Double void** — guarded by the `status === 'VOID'` check; the transition is terminal.
- **Voiding into a closed period** — `assertPeriodOpen` blocks it, consistent with bill/payment void.
- **UI still calling the old PUT path** — removed from the status maps and the PUT handler now 422s `VOID`, so both client and server reject it.

## Rollout

- No migration, no reseed. Defaults unchanged. Ships behind the normal RBAC for the returns/notes modules (same permission that already gates editing the note).
