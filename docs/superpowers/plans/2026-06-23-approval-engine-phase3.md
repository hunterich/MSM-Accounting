# Approval Engine — Phase 3 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Builds on the proven Phase 1/2 engine. Phase 3 is the HARDEST: these 3 modules POST to the GL on create (no real unposted step), so we add a `PENDING_APPROVAL` holding state and gate the finalize transition.

**Goal:** Extend approval enforcement to the last 3 modules — **AR Payments, AP Payments, Stock Adjustments** — completing all 10. (`ar_payments`, `ap_payments`, `inv_adj`.)

**Key difference from Phase 1/2:** payments/adjustments fuse create+post. We make the *posting transition* the gated step: when approval is required, finalizing creates/leaves the doc at `PENDING_APPROVAL` and posts nothing; on approve, the finalizer posts (reusing existing libs) and sets the live status.

---

## Per-module map (from exploration)

| documentType | configKey | moduleKey | status enum | live status | posting fn | finalize routes |
|---|---|---|---|---|---|---|
| `AR_PAYMENT` | `ar_payments` | `AR_PAYMENTS` | `PaymentStatus` | COMPLETED | `postArPaymentIfNeeded(tx,orgId,id)` (standalone, idempotent via `journalEntryId`) | POST `/ar-payments` + PUT `/ar-payments/[id]` |
| `AP_PAYMENT` | `ap_payments` | `AP_PAYMENTS` | `PaymentStatus` (shared) | COMPLETED | `postApPaymentIfNeeded(tx,orgId,id)` | POST `/ap-payments` + PUT `/ap-payments/[id]` |
| `STOCK_ADJUSTMENT` | `inv_adj` | `INV_ADJ` | `StockAdjustmentStatus` | APPROVED | `postStockAdjustmentToLedger(tx,orgId,{lines})` — NOT standalone; **no `journalEntryId` token** | POST `/stock-adjustments` |

**Critical facts:**
- `postArPaymentIfNeeded`/`postApPaymentIfNeeded` skip posting when `status ∈ UNPOSTABLE_STATUSES = {DRAFT, VOID}` or `journalEntryId` set. We must **add `PENDING_APPROVAL` to `UNPOSTABLE_STATUSES`** so a held payment never posts even if the fn is reached.
- A payment posts only when its status is "postable" (not DRAFT/VOID — i.e. COMPLETED/PROCESSING). So gate the finalize transition = when a payment would be created/updated into a postable status.
- `postStockAdjustmentToLedger` needs the lines array and has **no idempotency token**. Add a standalone wrapper `postStockAdjustmentIfNeeded(tx,orgId,id)` that fetches adj+lines, guards `if (status === 'APPROVED') return` (already posted), then posts.
- **Stock Count** generates an `APPROVED` StockAdjustment internally via `postStockCount` → `postStockAdjustmentToLedger`. That path is NOT a user create route and must remain ungated. Only the user-facing `POST /stock-adjustments` is gated.
- **Reject-revert:** all 3 → `DRAFT`.

---

## Tasks

### P3-1: Schema
- `prisma/schema.prisma`: add `PENDING_APPROVAL` to `PaymentStatus` and `StockAdjustmentStatus`; add `AR_PAYMENT, AP_PAYMENT, STOCK_ADJUSTMENT` to `ApprovalDocumentType`.
- `npx prisma db push && npx prisma generate`. No seed change. Verify typecheck. Commit.

### P3-2: posting-lib prep
- `lib/payment-posting.ts`: add `'PENDING_APPROVAL'` to `UNPOSTABLE_STATUSES` (so held payments never post).
- `lib/stock-adjustment-posting.ts`: add `export async function postStockAdjustmentIfNeeded(tx, orgId, adjustmentId): Promise<void>` — fetch the adjustment + its lines; `if (!adj || adj.status === 'APPROVED') return;` else call `postStockAdjustmentToLedger(tx, orgId, { id, number, date, warehouseId, lines })`.
- Verify typecheck + `test:int` (existing stock/payment GL invariants still pass). Commit.

### P3-3: registry + finalizers + reject-revert
- `lib/approval/registry.ts`: add `AR_PAYMENT→{ar_payments,AR_PAYMENTS}`, `AP_PAYMENT→{ap_payments,AP_PAYMENTS}`, `STOCK_ADJUSTMENT→{inv_adj,INV_ADJ}`.
- `lib/approval/finalizers.ts`:
  - `AR_PAYMENT`: `await tx.aRPayment.update({where:{id},data:{status:'COMPLETED',updatedAt:new Date()}}); await postArPaymentIfNeeded(tx,orgId,id);` (set COMPLETED FIRST — postArPaymentIfNeeded skips while PENDING_APPROVAL).
  - `AP_PAYMENT`: same with `tx.aPPayment` + `postApPaymentIfNeeded`.
  - `STOCK_ADJUSTMENT`: `await postStockAdjustmentIfNeeded(tx,orgId,id); await tx.stockAdjustment.update({where:{id},data:{status:'APPROVED',updatedAt:new Date()}});` (post while still PENDING_APPROVAL, then mark APPROVED).
- `lib/approval/engine.ts` `rejectRequest` revert map: add `AR_PAYMENT→tx.aRPayment DRAFT`, `AP_PAYMENT→tx.aPPayment DRAFT`, `STOCK_ADJUSTMENT→tx.stockAdjustment DRAFT`.
- Verify typecheck. Commit.

### P3-4: wire routeForApproval into the finalize routes
Mirror the Phase-1/2 pattern (routed ⇒ PENDING_APPROVAL + no posting; not-routed ⇒ unchanged; guard `x-user-id` 401).
- `ar-payments/route.ts` POST: after create, if `created.status` is postable (NOT `DRAFT`/`VOID`), `routeForApproval(...'AR_PAYMENT'...)`; routed ⇒ set `PENDING_APPROVAL` + skip `postArPaymentIfNeeded`; else post as today. (DRAFT create unchanged.) Reflect held status in the response.
- `ar-payments/[id]/route.ts` PUT: this completes a DRAFT payment (transition into a postable status, calls `postArPaymentIfNeeded`). Gate that transition the same way: routed ⇒ `PENDING_APPROVAL` + skip post.
- `ap-payments/route.ts` POST + `ap-payments/[id]/route.ts` PUT: same as AR with `'AP_PAYMENT'`.
- `stock-adjustments/route.ts` POST: after create + lines, `routeForApproval(...'STOCK_ADJUSTMENT'...)`; routed ⇒ set `PENDING_APPROVAL` + skip `postStockAdjustmentToLedger`; else post as today. **Do NOT touch `lib/stock-count-posting.ts`** (internal APPROVED adjustments stay ungated). Reflect held status in the response.
- Verify typecheck + `test:int`. Commit. **Full two-stage review on this task.**

### P3-5: integration tests (functional gate)
- New `lib/__tests__/integration/approval-engine-phase3.int.test.ts`: for AR_PAYMENT, AP_PAYMENT, STOCK_ADJUSTMENT — requirement ON ⇒ finalize routes (status `PENDING_APPROVAL`, `journalEntryCount===0`, one PENDING request); approve ⇒ posts (live status + balanced JE via `assertTrialBalanced`); reject ⇒ `DRAFT`, no JE. Seed payments with an allocation + amount so posting balances; seed a stock adjustment with one line (qty diff × unit cost) so it posts a variance JE.
- `npm run test:int:setup` then `npm run test:int`. Commit.

### P3-6: approvals display for the 3 new types
- `src/app/api/v1/approvals/route.ts`: extend the `DOCUMENT_TYPES` tuple + per-type summary fetch: `AR_PAYMENT→aRPayment {number, totalAmount, customer.name}`, `AP_PAYMENT→aPPayment {number, totalAmount, vendor.name}`, `STOCK_ADJUSTMENT→stockAdjustment {number, amount=sum(lines.totalValue) or null, party=reason or warehouse name}`.
- `src/views/ar/ApprovalInbox.tsx`: add the 3 types to `DOCUMENT_TYPE_LABELS` + `MODULE_KEY_BY_TYPE` (AR_PAYMENT→`ar_payments`, AP_PAYMENT→`ap_payments`, STOCK_ADJUSTMENT→`inv_adj`).
- `src/components/dashboard/widgets/PendingApprovalsWidget.tsx`: add the 3 labels.
- Verify typecheck + build. Commit.

### P3-7: final pass + restore unit tests
- The new `routeForApproval` calls add a `tx.organization.findUnique` dependency to the payment/stock-adjustment routes → any route UNIT tests with narrow `tx` mocks will 500. Find them (`src/app/api/v1/__tests__/` touching ar-payments/ap-payments/stock-adjustments) and add `organization: { findUnique: vi.fn(async () => ({ approvalRequirements: null })) }` to their tx mocks (keeps approval OFF → posts as before). Update the `tenant-isolation-policy` baseline if the new `x-user-id` guards changed `x-org-id!` counts (tighten only).
- Run all: `npm run typecheck` (only node-cron), `npm test` (≥306), `npm run test:int` (+3 new), `npm run build`. Commit any fixups.

---

## At merge
`prisma db push` + reseed (enum values only). Defaults all-off → no behavior change until a toggle is flipped. After Phase 3: **all 10 modules enforce approval.**

## Carried-forward follow-ups (still deferred, document in memory)
Non-admin approver roles-write API; block emailing an unapproved invoice; DB-level partial-unique for open PENDING; edit-cancels-pending-request; **recurring-bill autoPost + opening-balance import create OPEN bills with no GL and outside the gate** (pre-existing, flagged by Phase-2 review — both an approval gap and a latent no-JE-on-OPEN-bill integrity oddity).
