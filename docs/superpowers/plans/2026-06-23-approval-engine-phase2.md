# Approval Engine — Phase 2 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Builds on the proven Phase 1 engine (`lib/approval/`). Same pattern: register documentType → descriptor + finalizer, add a `PENDING_APPROVAL` holding state, insert `routeForApproval` at each finalize route (including create-as-finalized POST paths).

**Goal:** Extend approval enforcement to **Bills, Sales Orders, Payroll Runs, Credit Notes, Debit Notes, Sales Returns, Purchase Returns** — taking the engine from 2 to 9 of the 10 configured modules. (`ar_credits` = CreditNote+SalesReturn; `ap_debits` = DebitNote+PurchaseReturn.)

**Reuses (no posting logic rewritten):** `postBillToLedger`, `postCreditNoteOnApply`, `postDebitNoteOnApply`, `postSalesReturnOnApproval`, `postPurchaseReturnOnApproval`. Payroll posting is inline today → extract to a lib first. Sales Orders post no GL (status-only finalize).

**Phase-1 invariant carried forward:** every finalize path (PUT *and* create-as-finalized POST) calls `routeForApproval` before posting; when routed → hold at `PENDING_APPROVAL`, post nothing.

---

## Per-module map (from codebase exploration)

| documentType | configKey | moduleKey | status enum | finalize transition | posting fn (reused) | finalize route(s) |
|---|---|---|---|---|---|---|
| `BILL` | `ap_bills` | `AP_BILLS` | `BillStatus` | DRAFT→OPEN | `postBillToLedger(tx,orgId,bill)` | PUT `/bills/[id]` + POST `/bills` (create-as-OPEN) |
| `SALES_ORDER` | `ar_sales_orders` | `AR_SALES_ORDERS` | `SoStatus` | DRAFT→CONFIRMED | none (no GL) | PUT `/sales-orders/[id]` |
| `PAYROLL_RUN` | `hr_payroll` | `HR_PAYROLL` | `PayrollRunStatus` | REVIEWED→POSTED | inline → EXTRACT to `lib/payroll-posting.ts` | POST `/payroll-runs/[id]/post` |
| `CREDIT_NOTE` | `ar_credits` | `AR_CREDITS` | `CreditNoteStatus` | DRAFT→APPLIED | `postCreditNoteOnApply(tx,id)` | PUT `/credit-notes/[id]` |
| `DEBIT_NOTE` | `ap_debits` | `AP_DEBITS` | `DebitNoteStatus` | DRAFT→APPLIED | `postDebitNoteOnApply(tx,id)` | PUT `/debit-notes/[id]` |
| `SALES_RETURN` | `ar_credits` | `AR_CREDITS` | `ReturnStatus` | DRAFT→APPROVED | `postSalesReturnOnApproval(tx,id)` | PUT `/sales-returns/[id]` + POST `/sales-returns` (create-as-APPROVED) |
| `PURCHASE_RETURN` | `ap_debits` | `AP_DEBITS` | `ReturnStatus` (shared) | DRAFT→APPROVED | `postPurchaseReturnOnApproval(tx,id)` | PUT `/purchase-returns/[id]` + POST `/purchase-returns` (create-as-APPROVED) |

**Reject-revert target:** all → `DRAFT`, **except `PAYROLL_RUN` → `REVIEWED`** (its pre-post editable state; reverting to DRAFT would lose CALCULATED/REVIEWED).

---

## Tasks

### Task P2-1: Schema — enum widening (+ db push + generate)
- `prisma/schema.prisma`: add `PENDING_APPROVAL` to `BillStatus`, `SoStatus`, `PayrollRunStatus`, `CreditNoteStatus`, `DebitNoteStatus`, `ReturnStatus`; add `BILL, SALES_ORDER, PAYROLL_RUN, CREDIT_NOTE, DEBIT_NOTE, SALES_RETURN, PURCHASE_RETURN` to `ApprovalDocumentType`.
- `npx prisma db push && npx prisma generate`. No seed change (canApprove already seeded for all modules).
- Verify: typecheck (only pre-existing node-cron error). Commit.

### Task P2-2: Registry + reject-revert
- `lib/approval/registry.ts`: add the 7 descriptors per the table.
- `lib/approval/engine.ts` `rejectRequest`: extend the revert switch to cover all new documentTypes (revert to `DRAFT`, except `PAYROLL_RUN`→`REVIEWED`), updating the correct prisma model per type (`bill`, `salesOrder`, `payrollRun`, `creditNote`, `debitNote`, `salesReturn`, `purchaseReturn`).
- Verify: typecheck. Commit.

### Task P2-3: Extract payroll posting (refactor, behavior-preserving)
- Create `lib/payroll-posting.ts` `postPayrollRunToLedger(tx, orgId, payrollRunId): Promise<void>` — move the inline JE-building + `journalEntry.create` + `payrollRun.update({status:'POSTED', journalEntryId})` logic from `src/app/api/v1/payroll-runs/[id]/post/route.ts`. (It may set status POSTED itself; the finalizer/route will rely on that, OR have it NOT set status and let the caller set it — pick one and be consistent: prefer it posts the JE + links journalEntryId, and the CALLER sets status, mirroring how `postInvoiceSend` leaves status to the caller. Adjust the route accordingly.)
- Route calls the extracted fn. Existing payroll tests (if any) still pass.
- Verify: typecheck + any payroll tests + `test:int`. Commit.

### Task P2-4: Finalizers
- `lib/approval/finalizers.ts`: add finalizers to `FINALIZERS`:
  - `BILL`: load the bill with lines, `assertPeriodOpen(tx, orgId, issueDate)`, `postBillToLedger(tx, orgId, bill)`, then `tx.bill.update({status:'OPEN'})`. (Mirror the bills PUT finalize block.)
  - `SALES_ORDER`: `tx.salesOrder.update({status:'CONFIRMED'})` (no GL).
  - `PAYROLL_RUN`: `postPayrollRunToLedger(tx, orgId, id)` then `tx.payrollRun.update({status:'POSTED'})` (if the extracted fn doesn't set it).
  - `CREDIT_NOTE`: `postCreditNoteOnApply(tx, id)` then `tx.creditNote.update({status:'APPLIED'})`.
  - `DEBIT_NOTE`: `postDebitNoteOnApply(tx, id)` then `tx.debitNote.update({status:'APPLIED'})`.
  - `SALES_RETURN`: `postSalesReturnOnApproval(tx, id)` then `tx.salesReturn.update({status:'APPROVED'})`.
  - `PURCHASE_RETURN`: `postPurchaseReturnOnApproval(tx, id)` then `tx.purchaseReturn.update({status:'APPROVED'})`.
- The posting libs are idempotent via `journalEntryId`; finalizers run only on approve (no prior posting), so they post exactly once.
- Verify: typecheck. Commit.

### Task P2-5: Wire routeForApproval into finalize routes (riskiest — touches live posting paths)
For each finalize route, BEFORE the status-flip/posting, call `routeForApproval(tx, {orgId, userId, documentType, documentId})`; if routed → set the doc to `PENDING_APPROVAL` and SKIP posting; else proceed unchanged. Guard `x-user-id` (clean 401) where not already guarded. Mirror the Phase-1 invoice pattern (override the status to PENDING_APPROVAL when the request would otherwise stamp the live status).
- `bills/[id]/route.ts` PUT (DRAFT→OPEN) **and** `bills/route.ts` POST (create-as-OPEN/APPROVED).
- `sales-orders/[id]/route.ts` PUT (DRAFT→CONFIRMED).
- `payroll-runs/[id]/post/route.ts` POST (REVIEWED→POSTED).
- `credit-notes/[id]/route.ts` PUT (DRAFT→APPLIED).
- `debit-notes/[id]/route.ts` PUT (DRAFT→APPLIED).
- `sales-returns/[id]/route.ts` PUT (DRAFT→APPROVED) **and** `sales-returns/route.ts` POST (create-as-APPROVED).
- `purchase-returns/[id]/route.ts` PUT (DRAFT→APPROVED) **and** `purchase-returns/route.ts` POST (create-as-APPROVED).
- For create-as-finalized POST paths: if routed, create the doc as `PENDING_APPROVAL` and do NOT post (instead of creating OPEN/APPROVED + posting).
- Verify: typecheck + `test:int`. Commit. **Full two-stage review on this task.**

### Task P2-6: Integration tests (functional gate)
- Extend `lib/__tests__/integration/` with approval tests for representative Phase-2 types — at minimum **BILL** (GL posting + `assertTrialBalanced`), **CREDIT_NOTE or SALES_RETURN** (GL), and **PAYROLL_RUN**. For each: requirement ON → finalize routes (status `PENDING_APPROVAL`, `journalEntryCount===0`); approve → posts (correct status + balanced JE); reject → reverts (DRAFT, or REVIEWED for payroll).
- Run `npm run test:int:setup` then `npm run test:int`. Commit.

### Task P2-7: Final pass
- `npm run typecheck` (only node-cron), `npm test`, `npm run test:int`, `npm run build`. Commit any fixups.

---

## At merge
`prisma db push` + reseed (new enum values only; no data migration). Defaults all-off → no behavior change until a module's approval toggle is flipped.

## Carried-forward Phase-1 follow-ups (still deferred)
Non-admin approver roles-write API; block emailing an unapproved invoice; DB-level partial-unique for open PENDING; edit-cancels-pending-request. Not in Phase 2 scope.
