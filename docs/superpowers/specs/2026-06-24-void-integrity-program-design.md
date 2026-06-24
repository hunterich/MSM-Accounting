# Void Integrity Program — Design

**Date:** 2026-06-24
**Status:** Approved (program structure). Per-phase implementation plans to follow.
**Origin:** Started as "APPLIED → VOID does not reverse the journal entry on credit/debit notes (and returns)". A full audit of every GL-posting document showed the bug is systemic, so scope expanded to make **void/reverse trustworthy across the whole system**.

## Goal

Every document that posts to the general ledger must, when voided/cancelled/reversed, either (a) post a balanced reversing entry and unwind its non-GL side effects (inventory, allocations), or (b) be blocked when it can't safely reverse. No path may silently flip a status and leave a live journal entry behind. After any void, the trial balance, subledgers, and inventory return to their pre-posting state.

## Audit findings (verified against code, 2026-06-24)

Reference (correct) pattern: dedicated `POST /[id]/void` route → `lib/<doc>-void.ts` → guard → `reverseJournalEntry` (lib/reverse-journal-entry.ts) → unwind side effects → mark `VOID`.

| Document | Behavior today | Verdict |
|---|---|---|
| Bills | `POST /void` → `lib/bill-void.ts`: reverse JE + `reversePurchaseLayers` + guards (paid/allocated/period) | ✅ Correct |
| AR/AP Payments | `POST /void` → `lib/payment-void.ts`: reverse JE + drop allocations | ✅ Correct |
| Goods Receipts | `POST /unreceive` → `lib/unreceive-goods.ts`: reverse JE + inventory + reopen PO | ✅ Correct |
| **Invoices** | PUT `status:VOID` allowed on non-DRAFT (`[id]/route.ts:64,76`); posting only on DRAFT→SENT (`:100`); **no SENT→VOID reversal**, no payment-allocation guard. Two live JEs (AR recognition + COGS) left on the books. DELETE correctly blocked to DRAFT (`:336`). | 🔴 BROKEN |
| **Credit notes** | PUT `status:VOID` flips status; `postCreditNoteOnApply` JE left live (`credit-notes/[id]/route.ts`) | 🔴 BROKEN |
| **Debit notes** | Same as credit notes (`debit-notes/[id]/route.ts`) | 🔴 BROKEN |
| **Sales returns** | PUT status-only VOID allowed (`sales-returns/[id]/route.ts:49`); inventory JE + restock layer left live | 🔴 BROKEN |
| **Purchase returns** | Same; inventory removal JE + FIFO draw-down left live | 🔴 BROKEN |
| **Stock adjustments** | Posts GL + inventory whenever lines exist, **no status gate, no `journalEntryId` stamped** (`route.ts:69-92`); DELETE gated on DRAFT (`[id]/route.ts:98`) so a posted-but-DRAFT adjustment delete orphans the JE + inventory; **no void/reverse path** | 🟠 Risky / no reversal |
| **Bank expenses** | Edit/delete correctly blocked when posted (`bank-transactions/[id]/route.ts:37,108`), but the error says "void it instead" and **no void endpoint exists** | 🟡 Stuck, no corruption |
| **Payroll runs** | Post idempotent + immutable when POSTED (guarded); **no unpost/reverse** | 🟡 Gap, no corruption |
| **Asset disposal / depreciation** | Guarded against double-post; **no reverse** | 🟡 Gap, no corruption |
| **Manual journal entries** | Append-only: POSTED entries can't be edited/deleted (`journal-entries/[id]/route.ts:25,70`), FKs `onDelete: SetNull`; balance enforced. **No reverse endpoint** exposed (helper exists internally) | 🟡 Gap, no corruption |

Confidence: 🔴 and 🟠 rows verified by direct read. 🟡 rows ("blocked, no reversal") came from read-only audit agents and are lower-risk to act on (they report *safe-but-incomplete*); reconfirm when each is implemented in Phase 6.

## Shared design (the one pattern, used by every phase)

1. **Endpoint:** `POST /api/v1/<entity>/[id]/void` (manual journals use `/reverse`). Shape copied from `src/app/api/v1/bills/[id]/void/route.ts`: `withHandler` + `requireOrg` + `prisma.$transaction` + `logAudit({ action: 'VOID' })` + return the updated document. Void dated `new Date()` unless a date is supplied.
2. **Core lib `lib/<entity>-void.ts`:** find document → guards (not found 404; already VOID 422; not posted / no JE 422 "delete the draft instead"; has dependents e.g. allocations 422; `assertPeriodOpen`) → `reverseJournalEntry` for each posting JE → unwind non-GL side effects → mark `status: 'VOID'`. Leave the original posting JE(s) in place (append-only ledger); the document keeps pointing at them for audit. Void is terminal.
3. **Close the silent path:** the PUT handler rejects `status: 'VOID'` (422, "void through POST /:id/void"). DRAFT-only documents keep their existing DELETE path.
4. **Frontend:** `useVoid<Entity>()` hook (POST + query invalidation) and a "Void" row action on posted rows with a confirm dialog, mirroring `src/views/ap/Bills.tsx`.
5. **Tests:** unit (mocked) for the lib + route guards; integration (`npm run test:int`, real Postgres) "void round-trip": post → void → assert trial balance == pre-post snapshot, subledger restored, inventory lots/ledger restored, status VOID, posting+reversal JEs net to zero.

### Resolving the posting JE(s) to reverse

Documents with a `journalEntryId` column (notes, returns, payments, bills, bank txns, payroll) reverse by that token. Documents without one (invoices: two JEs; stock adjustments) reverse by **deterministic memo match** — the established `bill-void.ts:64-71` fallback. Posting memos are deterministic: invoices use `Sales recognition: <number>` and `COGS auto-post: <number>`; stock adjustments use their number. Memo-based reversal avoids a migration. **Decision (confirmed with user):** use memo match for invoices/stock-adjustments. The sturdier alternative — a `sourceType`/`sourceId` document link on every `JournalEntry`, looked up by exact ID — was explicitly considered and deferred; it adds a schema migration and is not required for correctness (invoices post two JEs, so a single `journalEntryId` column wouldn't suffice anyway). Memo format is code-generated and unique per document; integration tests assert the exact reversal lines so a format drift fails loudly. May be revisited as future hardening.

### Inventory un-consume primitive (the one new piece of engineering)

Documents that **consumed** inventory (invoice COGS, purchase-return removal) drew down FIFO/WA layers; voiding must put that stock back. There is no existing primitive for this. **Decision: re-add the removed quantity as a fresh inbound cost layer at the recorded consumed cost** (value-neutral, mirrors how sales-return restock already works via `addCostLayer`), rather than exact-lot restoration. Documents that **added** inventory (sales-return restock, stock-adjustment increase) reverse by removing those layers — generalize `reversePurchaseLayers` (currently hardcoded to `documentType: PURCHASE`) to accept the document type, keeping its "blocked if already consumed/sold" guard. Both primitives live in `lib/inventory-costing.ts` and are built in Phase 2.

## Phases (approved build order)

Each phase is independently shippable and reviewed on its own; each gets its own implementation plan.

### Phase 1 — Credit & Debit Notes
AR/AP only, no inventory, no migration. Detailed design already written: see `docs/superpowers/specs/2026-06-24-note-void-reversal-design.md`. Fast win that establishes the shared endpoint/UI/test pattern.

### Phase 2 — Foundation (inventory primitives + test helper)
- Generalize `reversePurchaseLayers` → reverse added layers for a given `(documentType, documentId)`, retaining the consumed-guard.
- New un-consume helper: re-add drawn-down quantity as an inbound layer at recorded consumed cost for a given `(documentType, documentId)`.
- Reusable integration "void round-trip" assertion in `lib/__tests__/integration`.
No user-facing change; pure infrastructure consumed by Phases 3–5.

### Phase 3 — Invoices
`POST /invoices/[id]/void` → `lib/invoice-void.ts`: reverse the AR-recognition JE **and** the COGS JE (memo match), un-consume the COGS inventory (Phase 2 primitive), guard: block when AR payments are allocated (unallocate first), `assertPeriodOpen`. Block PUT `status:VOID`. Void button on the Invoices list.

### Phase 4 — Sales & Purchase Returns
- Sales-return void: reverse inventory JE + remove the SALES_RETURN restock layer (Phase 2 generalized reversal; block if re-sold).
- Purchase-return void: reverse inventory JE + un-consume the PURCHASE_RETURN draw-down (Phase 2 un-consume).
- Block PUT `status:VOID`; Void actions on both list views. (Note: a return's financial leg is on its linked credit/debit note — voided separately via Phase 1.)

### Phase 5 — Stock Adjustments
Add `POST /stock-adjustments/[id]/void` → reverse the variance JE + unwind the cost layers/ledger rows it wrote. Fix the orphan risk: either gate posting on `status === APPROVED` or block DELETE when a posting exists (decide in the plan). Stamp/track the posting for clean reversal.

### Phase 6 — No-reversal gaps (no corruption today, capability-only)
- `POST /bank-transactions/[id]/void` → `lib/bank-transaction-void.ts` (reverse the expense JE); satisfies the existing "void it instead" guidance.
- Payroll run reverse/unpost → reverse the payroll summary JE; reopen the run.
- Asset disposal reversal (reverse gain/loss JE, restore ACTIVE) and a depreciation reversal path.
- `POST /journal-entries/[id]/reverse` exposing `reverseJournalEntry` for manual entries.
Reconfirm each 🟡 finding before building (see confidence note above).

## Cross-cutting

- **RBAC:** void reuses the edit/delete permission already gating each module.
- **Period lock:** every void is `assertPeriodOpen`-guarded; the reversal is dated at the void date.
- **Audit log:** every void writes `logAudit({ action: 'VOID' })`.
- **No silent truncation:** if any guard blocks a void (paid invoice, consumed stock, closed period), it returns a clear 422 the UI surfaces.

## Risks

- **Inventory un-consume accuracy** — re-adding at recorded cost is value-neutral but perturbs FIFO ordering for future draws; documented and accepted (consistent with existing sales-return restock simplification).
- **Memo-based JE resolution** — relies on deterministic posting memos; covered by integration tests asserting exactly the expected reversal lines.
- **Scope creep across 6 phases** — mitigated by independent, individually-reviewed phases sharing one pattern.

## Out of scope

- Partial/line-level voids (whole-document only).
- Re-open-for-edit after void (replacement = new document, matching current note guidance).
