# Save-Time Approval Enforcement — Server-Enforced Approval Engine

> Status: Design approved 2026-06-23. Closes ROADMAP §2.7 "Save-time enforcement of
> `approvalRequirements` toggles" and delivers the generic engine parked in §4.4
> (Workflow / Approval Engine).

## Plain-English summary

Think of the books as a filing cabinet. Today, finalizing a document (send invoice, post
payment) files it straight into the cabinet — it's on the books at once. Approval adds an
IN-tray in between: when a document type needs approval, finalizing drops it into the
approver's tray as "Pending Approval" instead of posting it. The approver files it (approve →
posts) or hands it back (reject → draft). Three moving parts make this real:

1. The "which documents need approval" switches move from the web browser into the database,
   so the server that records money can actually see and enforce them.
2. Every document type needs an IN-tray to wait in. Invoices/POs already have one; payments
   and stock adjustments post the instant they're created, so they must be changed to
   "draft first, post on approval" (the hardest part — done last).
3. A place to see and act on the tray: a new dashboard widget + the existing Approval Inbox.

## Problem

The Settings → Approval Rules tab exposes 10 per-module "requires approval" toggles, but
they are **purely cosmetic**:

- The config lives **only in the browser** (`useSettingsStore.approvalRequirements`,
  localStorage). The server never sees it, so it cannot enforce it.
- No finalize/post path checks the flag. A user can create an invoice and push it straight
  to `SENT` even when "Invoices require approval" is on.
- A real approval workflow (`ApprovalRequest` + submit/approve/reject + `PENDING_APPROVAL`)
  exists **only for Invoices and Purchase Orders**. The other 8 modules have no holding
  state to wait in before they hit the books.

## Goal

Make all 10 configured modules actually enforce approval, **on the server**, with a single
generic mechanism. Chosen behavior (confirmed with owner):

- **Scope:** all 10 modules.
- **Save behavior:** *auto-route at finalize* — the user clicks their normal finalize button;
  if approval is required and not yet granted, the document is held as Pending Approval
  instead of posting, and the user sees "Sent for approval." No separate "submit" button,
  no way to bypass.
- **Who approves:** a new per-module `canApprove` RBAC permission (Admins implicitly approve
  everything).
- **Self-approval:** blocked for non-admins; **admins are exempt** (can approve their own),
  with an org toggle `requireDistinctApproverForAdmins` (default **off**) to tighten later.

## Non-Goals

- Multi-level / chained approval (Manager → Director). Single approval step only.
- Email notifications on pending approvals (existing sidebar badge is enough for v1).
- Approval for master data (customers, vendors, items) — transactions only.

---

## Architecture

Five pieces. The first three are the engine; the last two are per-module wiring and UI.

### 1. Config moves server-side (source of truth)

- Add `approvalRequirements Json?` to `Organization` — the 10 boolean keys
  (`ar_sales_orders, ar_invoices, ar_payments, ar_credits, ap_pos, ap_bills, ap_payments,
  ap_debits, inv_adj, hr_payroll`), default all `false`.
- Add `requireDistinctApproverForAdmins Boolean @default(false)` to `Organization`.
- New API `GET/PUT /api/v1/settings/approval-requirements` (PUT is admin-only, validated
  with zod). Returns/accepts the 10 keys + the admin toggle.
- `useSettingsStore.approvalRequirements` stops being the source of truth: the Settings tab
  reads/writes via a new `useApprovalSettings` React Query hook. The Zustand field is removed
  (or kept only as a render cache hydrated from the API) to avoid a second, stale copy.

### 2. The approval guard (the heart) — `lib/approval/`

- `requiresApproval(org, moduleKey): boolean` — reads `org.approvalRequirements[moduleKey]`.
- `assertApprovalSatisfied(tx, { orgId, moduleKey, documentType, documentId }): Promise<void>`
  — throws `ApprovalRequiredError` (new error in `lib/errors.ts`, maps to HTTP 409) if the
  module requires approval **and** there is no `ApprovalRequest` row with status `APPROVED`
  for `(orgId, documentType, documentId)`.
- `userCanApprove(orgId, userId, roleType, moduleKey): Promise<boolean>` — Admins → true;
  otherwise look up the user's role's `RolePermission.canApprove` for that module (path:
  `UserOrganization` membership → `Role` → `RolePermission`).
- `assertCanApprove(req, moduleKey)` — header-driven wrapper for routes (401 if no
  user/org, 403 if not allowed).

### 3. Auto-route + generic approve/reject engine

- `routeOrFinalize(tx, ctx, finalizeFn)` helper used by every module's finalize path:
  - If `requiresApproval` and no approved request → create `ApprovalRequest` (status
    `PENDING`, `requestedById = userId`), set the document into its holding state, and
    return `{ routed: true }` **without** calling `finalizeFn`. (No GL is posted.)
  - Else → call `finalizeFn(tx)` (the existing posting logic) and return `{ routed: false }`.
- Generic routes keyed off the `ApprovalRequest` record:
  - `POST /api/v1/approvals/[id]/approve` — `assertCanApprove` + self-approval rule, then
    dispatch by `documentType` to that module's finalize function (reusing existing posting
    libs) inside one `prisma.$transaction`; mark request `APPROVED`; audit-log.
  - `POST /api/v1/approvals/[id]/reject` — revert the document to `DRAFT`, mark request
    `REJECTED`, store `rejectionReason`; audit-log.
- `lib/approval/finalizers.ts` — a `documentType → finalizeFn` dispatch map. Each entry
  reuses the existing posting library (no posting logic is rewritten):
  - `INVOICE` → invoice send (COGS + GL) · `PURCHASE_ORDER` → set APPROVED
  - `SALES_ORDER` → set CONFIRMED · `BILL` → `postBillToLedger`
  - `AR_PAYMENT` / `AP_PAYMENT` → `lib/payment-posting`
  - `CREDIT_NOTE` / `SALES_RETURN` → `lib/sales-return-posting`
  - `DEBIT_NOTE` / `PURCHASE_RETURN` → `lib/purchase-return-posting`
  - `STOCK_ADJUSTMENT` → adjustment posting · `PAYROLL_RUN` → payroll post
- The existing per-doc invoice/PO `submit-approval`/`approve`/`reject` routes are refactored
  to delegate to this engine (no duplicate logic). `ApprovalRequest.documentType` enum is
  widened to cover all the types above; add a partial unique guard so a document can't have
  two open `PENDING` requests at once.

### 4. A holding state for every document

Documents must be able to wait **unposted** before approval. Two cases:

| Module key | Document type(s) | Finalize transition (guarded) | Holding-state work |
|---|---|---|---|
| `ar_invoices` | Invoice | DRAFT → SENT (posts COGS+GL) | already has `PENDING_APPROVAL` |
| `ap_pos` | PurchaseOrder | DRAFT → APPROVED | already has `PENDING_APPROVAL` |
| `ar_sales_orders` | SalesOrder | DRAFT → CONFIRMED | add `PENDING_APPROVAL` to status enum |
| `ap_bills` | Bill | DRAFT → OPEN/APPROVED (posts) | add `PENDING_APPROVAL` to status enum |
| `hr_payroll` | PayrollRun | DRAFT → POSTED (`/post`) | add `PENDING_APPROVAL` to status enum |
| `ar_payments` | ARPayment | create → posts now | **create unposted; post becomes the guarded step** |
| `ap_payments` | APPayment | create → posts now | **create unposted; post becomes the guarded step** |
| `ar_credits` | CreditNote, SalesReturn | approve/apply → posts | hold via `PENDING_APPROVAL` before posting |
| `ap_debits` | DebitNote, PurchaseReturn | approve/apply → posts | hold via `PENDING_APPROVAL` before posting |
| `inv_adj` | StockAdjustment | create/post → writes ledger+GL | **create unposted; post becomes the guarded step** |

The four modules in bold (payments ×2, stock adjustments) currently **post on create** and
carry the bulk of the work: their create endpoint must produce an unposted record, and a
distinct post/finalize step (newly guarded) does the GL. Exact current entry points are
confirmed during planning; the engine itself is module-agnostic.

> **Design rule:** every finalize/post path that this engine touches must already call
> `assertPeriodOpen` (per the posting-integrity convention). The approval guard is added
> *alongside*, not instead of, the period guard.

### 5. RBAC: per-module Approve permission + Approval Inbox

- `RolePermission.canApprove Boolean @default(false)`. Seed `true` for the Admin role on all
  modules. Settings → Security & Roles gains an "Approve" column in the permission matrix,
  persisted through the existing role-permission API.
- Client mirror: a `canApprove(moduleKey)` selector in `useAccessStore` so the Approval Inbox
  hides Approve/Reject buttons a user can't use (UX only — the server is the real gate).
- Generalize `ApprovalInbox.tsx` to list pending requests across all 10 document types,
  filterable by type, with Approve / Reject (+ reason). Reuse the existing `pending_approvals`
  sidebar badge.
- **Dashboard widget `pending_approvals`** — new widget in `src/config/dashboardWidgets.js`
  showing a count + the waiting documents (type, number, amount, requester) with click-through
  to the inbox. Gated so it renders **only for users who hold `canApprove` on at least one
  module** (reuses the dashboard's existing per-permission widget filtering). Added to the
  default widget set for Admins.

---

## Data Flow (auto-route, e.g. a staff member posts an AP payment when `ap_payments` is on)

1. Staff fills the payment form, clicks **Post**. Front end calls the normal post endpoint.
2. Endpoint runs inside `prisma.$transaction`: `assertPeriodOpen` → `routeOrFinalize`.
3. `requiresApproval(org, 'ap_payments')` is true and no approved request exists → engine
   creates `ApprovalRequest(PENDING, requestedById=staff)`, sets payment to `PENDING_APPROVAL`,
   returns `{ routed: true }`. **No GL posted.** Response: "Sent for approval."
4. Admin opens Approval Inbox, clicks **Approve** → `POST /approvals/[id]/approve`:
   `assertCanApprove('ap_payments')` passes (admin), self-approval rule passes (different user),
   dispatch → `payment-posting` posts DR AP / CR Bank, request marked `APPROVED`, payment now
   `COMPLETED`.
5. (Or **Reject** → payment back to `DRAFT`, request `REJECTED` with reason; nothing posted.)

## Error Handling

- `ApprovalRequiredError` → 409 with a clear message; should never surface to the user in the
  auto-route path (it's caught and turned into the "Sent for approval" outcome), but protects
  any direct/legacy finalize call.
- Approve on a non-pending document / missing request → 400/404 (mirror existing invoice/PO
  routes).
- Not-permitted approver → 403; self-approval violation → 403 with a distinct message.
- Editing a document while it has a `PENDING` request reverts it to `DRAFT` and cancels the
  open request (forces re-submission) — prevents approving stale content.

## Testing

- **Unit:** `requiresApproval`, `userCanApprove` (admin shortcut, flag on/off, no-row default),
  self-approval policy (staff blocked, admin exempt, toggle on), `routeOrFinalize` (routes vs
  finalizes), finalizer dispatch table completeness.
- **Integration (real Postgres harness):** for at least one easy module (invoice) and one
  hard module (AP payment): required+unapproved finalize posts **nothing** to the GL and
  leaves the doc `PENDING_APPROVAL`; approve posts the correct balanced JE; reject reverts to
  DRAFT with no GL; period-lock still enforced on approve; trial balance stays balanced.

## Migration / Rollout

- Schema changes (`Organization.approvalRequirements`, `requireDistinctApproverForAdmins`,
  `RolePermission.canApprove`, widened `ApprovalRequest.documentType`, new `PENDING_APPROVAL`
  states, `rejectionReason`) ship via `prisma db push` + reseed at merge.
- Defaults are all-off / no-approval, so the system behaves exactly as today until an admin
  turns a toggle on — safe, incremental rollout.

## Phased Delivery

Built in three independently-shippable phases. After each, stop, demo it working, and get the
owner's go-ahead before starting the next — so work always halts at a clean, finished line.

### Phase 1 — Foundation + easy modules + dashboard widget
The complete engine, proven on the two modules that already have a holding state.
- Config server-side (`Organization.approvalRequirements` + `requireDistinctApproverForAdmins`)
  + settings API + Settings tab rewired off localStorage.
- RBAC `RolePermission.canApprove` + "Approve" column in Security & Roles + Admin seed.
- The guard (`requiresApproval`, `assertApprovalSatisfied`, `userCanApprove`,
  `assertCanApprove`), `routeOrFinalize`, and the generic `approve`/`reject` engine.
- Enforce on **Invoices** and **Purchase Orders** (refactor their existing routes onto the
  engine; widen `ApprovalRequest.documentType`).
- **Pending Approvals dashboard widget** + generalized Approval Inbox.
- **Usable on its own:** approvals fully work for invoices and POs.

### Phase 2 — Modules with an existing draft → finalize step
Extend enforcement to **Bills, Sales Orders, Payroll Runs, and Credit/Debit Notes & Returns**
(`ap_bills`, `ar_sales_orders`, `hr_payroll`, `ar_credits`, `ap_debits`). Each adds a
`PENDING_APPROVAL` holding state and a guarded finalize via the existing posting libs.
- **After Phase 2:** 7 of 10 document types enforce approval.

### Phase 3 — Post-on-create modules (hardest, last)
**Receive Payments, Send Payments, Stock Adjustments** (`ar_payments`, `ap_payments`,
`inv_adj`). Convert each from "post on create" to "create unposted → post on approval"; this
is the biggest behavior change and gets the most integration testing.
- **After Phase 3:** all 10 document types enforce approval.

## Effort

Large — comparable to the Backup/Restore build (multi-file, schema change, ~12–15 TDD tasks
spread across the three phases). The four post-on-create modules (payments ×2, stock
adjustments — Phase 3) dominate the effort because they need a new unposted-then-post lifecycle.
