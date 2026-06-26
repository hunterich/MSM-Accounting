# Server-Side Authorization (RBAC) — Design

- **Date:** 2026-06-25
- **Status:** Approved (design); pending implementation
- **Branch:** `claude/server-side-rbac`
- **Author:** Security & permissions audit follow-up

## Problem

The application authenticates every API request (a verified JWT cookie; `src/middleware.ts`
injects a trustworthy `x-org-id`/`x-user-id`/`x-role-type`), and it isolates each book's
data by `organizationId`. But it **does not authorize**: the shared helpers
`requireAuth`/`requireOrg` (`lib/api-utils.ts`) only check that the identity headers exist.
Of 158 API routes, only 7 check a role. Every other privileged endpoint trusts any
authenticated session.

Consequence: the per-employee permission model is enforced only in the browser
(`src/stores/useAccessStore.js`). A low-privilege employee (VIEWER/ACCOUNTANT/CUSTOM) can
bypass it by calling the API directly — posting payroll to the ledger, voiding posted
invoices/payments, creating/deleting journal entries and GL accounts, closing periods,
running depreciation, reading the audit trail, and even disabling the approval engine via
`organization/settings`. See the audit report for the full list.

Deployment context: a single company running **multiple books** (separate businesses), with
its own staff as users. Data is already separated per book; the gap is permission
enforcement. Backups are whole-database dumps spanning all books, so backup access also
needs to be a deliberately granted permission, not an incidental per-book admin capability.

## Goals

1. Enforce the existing permission matrix **on the server** for all state-changing
   operations and for sensitive reads.
2. Zero behavior change for legitimate users — the server allows exactly what the UI already
   shows each role.
3. Make it impossible to silently ship a new mutating route with no permission check
   (a build-time completeness guard).
4. Close the cheap auth-hardening gaps surfaced by the audit (org-settings admin lock,
   Google login replay nonce, CSRF defense, cookie `secure` based on real HTTPS).

## Non-Goals

- Redesigning the role/permission data model — it already exists (`RolePermission`).
- Moving enforcement into edge middleware — the edge runtime can't query Prisma for
  per-request permissions; enforcing in the Node-runtime route handlers keeps permissions
  always-fresh (no stale-token window) and is where Prisma already works.
- Rate limiting / account lockout / session revocation (out of audit scope).
- Per-book backup isolation / logical per-org export (separate, larger effort; we instead
  gate whole-DB backup behind an explicit `SYSTEM_BACKUP` permission).

## Permission Model (existing, used as-is)

- `ModuleKey` enum (Prisma): DASHBOARD, GL_COA, GL_JOURNAL, AR_INVOICES, AR_SALES_ORDERS,
  AR_PAYMENTS, AR_CREDITS, AR_CUSTOMERS, AP_POS, AP_BILLS, AP_PAYMENTS, AP_DEBITS, AP_VENDORS,
  INV_ITEMS, INV_CATEGORIES, INV_ADJ, HR_EMPLOYEES, HR_ATTENDANCE, HR_PAYROLL, BANKING,
  INTEGRATIONS, REPORTS, COMPANY, SETTINGS, SYSTEM_BACKUP.
- `RolePermission(roleId, moduleKey)` → `canView, canCreate, canEdit, canDelete, canApprove`.
- `RoleType`: ADMIN, ACCOUNTANT, VIEWER, CUSTOM. **ADMIN bypasses all checks.**
- Lookup path: `UserOrganization(userId, organizationId, isActive:true)` → `role` →
  `roleType` + `permissions`.

## Design

### 1. Authorization helper — `lib/authz.ts`

```
type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve';

// Throws ApiError(403) if the caller's role lacks `action` on `moduleKey`.
// ADMIN short-circuits to allowed. Reads {orgId,userId,roleType} from headers
// (already verified + injected by middleware). One indexed query per call.
async function requirePermission(req, moduleKey: ModuleKey, action: Action): Promise<void>

// Convenience for the auth actor (mirrors approvalActor()).
function authActor(req): { orgId, userId, roleType }
```

- Generalizes the proven `userCanApprove` query in `lib/approval/can-approve.ts`
  (same `userOrganization.findFirst → role.permissions` shape) to all five action flags.
- Maps `action` → column: view→canView, create→canCreate, edit→canEdit, delete→canDelete,
  approve→canApprove.
- Fail-closed: missing membership/permission row ⇒ 403.
- Accepts an optional Prisma `tx` so it can run inside an existing transaction when handy
  (not required).

### 2. Declarative route wrapper — `withPermission`

```
export const POST = withPermission(
  { module: 'HR_PAYROLL', action: 'create' },
  async (req, ctx) => { ... }
);
```

- `withPermission(descriptor, handler)` runs `requirePermission` then the handler, reusing
  `withHandler`'s existing error handling (so a 403 returns a clean JSON error and all
  current Prisma/ApiError handling is preserved).
- `descriptor` may be static `{module, action}` or a function `(req, ctx) => descriptor`
  for the rare route whose permission depends on the request.
- This is the single, greppable enforcement point. Routes that currently use `withHandler`
  upgrade to `withPermission`; raw try/catch routes (e.g. payroll `post`) convert too.

### 3. Action mapping rules

Default by HTTP method: `GET→view`, `POST→create`, `PUT/PATCH→edit`, `DELETE→delete`.
Explicit overrides for action sub-routes:

| Sub-route pattern | Module | Action | Rationale |
|---|---|---|---|
| `.../void` | owning module | delete | destructive reversal |
| `.../post` (payroll, periods) | owning module | create | finalizes ledger impact |
| `approvals/[id]/approve`/`reject`, `invoices|purchase-orders/[id]/approve`/`reject` | owning module | approve | approval decision (also keeps existing `assertApprovalAuthorized`) |
| `.../submit-approval` | owning module | edit | submitting own doc |
| `.../send-email` | owning module | edit | acting on the doc |
| `.../receive`, `.../unreceive`, `.../generate`, `.../activate`, `.../dispose`, `.../close`, `depreciation/run`, `recalculate-costing` | owning/closest module | create or edit (per destructiveness) | mutating actions |

Modules without a 1:1 `ModuleKey` (assets, accounting-periods, reconciliation, recurring-*,
delivery-notes, bank-statements) are mapped to the **closest existing module, never looser
than the browser already enforces**, by cross-referencing the client
`SUBITEM_PERMISSION_MAP`/`MODULE_KEYS` in `src/stores/useAccessStore.js`. Each such mapping
is recorded in the route map with a short comment. (Tentative: assets/depreciation →
`GL_JOURNAL`; accounting-periods → `SETTINGS`; reconciliation/bank-statements → `BANKING`;
recurring-invoices → `AR_INVOICES`; recurring-bills → `AP_BILLS`; delivery-notes →
`AR_SALES_ORDERS` — each confirmed against the client map during implementation.)

### 4. Reads (GET) policy — controlled blast radius

- **Mutations (POST/PUT/PATCH/DELETE and all action sub-routes): always enforced.** This is
  where the audit's damage lives.
- **Sensitive reads: enforced** with the matching `view` permission —
  `audit-logs`, `backup/*` (history/download), `payroll-runs/*`, `employees/*`,
  `reports`/financial exports, `organization/settings` (GET stays readable; PUT is admin).
- **Operational reference reads stay authenticated-only** (any active org member) —
  e.g. `accounts`, `customers`, `vendors`, `items`, `*-categories`, `warehouses`,
  `dashboard/summary`. These feed cross-module dropdowns; gating them per-module would break
  legitimate non-admin workflows (e.g. an AR clerk needs the account/customer lists). They
  expose only non-sensitive reference data within the user's own book.

### 5. Specific hardening (audit findings 2–5)

- **Finding 2 (backups):** replace the raw `x-role-type === 'ADMIN'` string checks on
  `backup/{run,history,settings}`, `backup/[id]/{download,restore}` with
  `requirePermission(SYSTEM_BACKUP, …)` (run/restore→create or a `manage` action mapped to
  canCreate; download/history→view; settings PUT→edit). The owner controls exactly who holds
  `SYSTEM_BACKUP`. ADMIN still bypasses. Document that a backup spans all books.
- **Finding 1 sub-case (org settings):** `organization/settings` PUT →
  `requirePermission(SETTINGS, 'edit')` (effectively admin/settings-holders), closing the
  "any user can disable the approval engine / change costing method" hole.
- **Finding 3 (Google OAuth replay):** generate a `nonce` client-side, pass it to the Google
  button, and assert `payload.nonce` server-side in `auth/google/route.ts`.
- **Finding 4 (CSRF):** require a custom header (`X-Requested-With: msm`) on state-changing
  requests, set centrally by `src/api/apiClient.js`; reject mutations lacking it. (Cheap
  defense-in-depth on top of the existing SameSite=Lax + single-origin CORS.)
- **Finding 5 (cookie `secure`):** set the auth cookie `secure` from an explicit
  `COOKIE_SECURE`/HTTPS signal rather than `NODE_ENV` alone, so non-prod HTTPS deployments
  still get a secure cookie. Keep `httpOnly` + `sameSite:'lax'`.

### 6. Completeness guard (test)

A Vitest test enumerates every `src/app/api/v1/**/route.ts`, detects exported mutating
handlers (POST/PUT/PATCH/DELETE) and sensitive-read GETs, and asserts each is wrapped by
`withPermission` (or appears in an explicit, reviewed allowlist — e.g. `auth/*`,
`OPTIONS` handlers, and the operational-reference GETs from §4). A new unguarded mutating
route fails the build. This is the guarantee that we don't miss one of 150 routes.

## Data Flow

1. Request → `middleware.ts` verifies JWT, injects `x-org-id/x-user-id/x-role-type`.
2. Route handler wrapped by `withPermission({module, action})`.
3. `requirePermission` reads the headers; if `roleType==='ADMIN'` → allow; else one query
   for the caller's `RolePermission` row for `module`; check the `action` flag.
4. Not allowed → `ApiError(403)` → clean JSON `{ error: 'Forbidden: …' }`.
5. Allowed → original handler runs unchanged (org scoping, accounting invariants, approval
   engine all still apply).

## Error Handling

- Unauthorized → 403 with `{ error }` (via existing `withHandler` path).
- Missing identity headers (shouldn't happen post-middleware) → 401, as today.
- The permission query failing (DB error) → fail-closed (propagates as 500, request denied).

## Testing

- **Unit:** `requirePermission` — ADMIN bypass; each action flag allow/deny; missing
  membership ⇒ deny; tx and non-tx callers.
- **Per-route behavioral:** for a representative high-risk set (payroll post, journal POST/
  DELETE, invoice/bill/payment void, accounts POST/DELETE, org-settings PUT, backup
  run/restore/download, audit-logs GET, depreciation run, costing recalc, import),
  assert VIEWER/insufficient role ⇒ 403 and ADMIN/granted role ⇒ proceeds.
- **Completeness test:** §6.
- **Regression:** the full existing suite (414+ tests) must stay green; the integration
  suite (`npm run test:int`) covers GL invariants.

## Rollout & Risk

- Biggest risk: mis-mapping a route ⇒ blocking a legitimate user. Mitigations: ADMIN always
  allowed; mappings mirror the client matrix exactly; completeness + behavioral tests; run
  the full suite before done.
- No DB migration required (uses existing tables). No new env required except the optional
  `COOKIE_SECURE` toggle (defaults preserve current behavior).
- Implemented in phases (helper + wrapper + completeness test → highest-risk routes →
  full sweep → hardening items), committing frequently (shared-checkout clobber mitigation).

## Open Items (resolved during implementation)

- Confirm each non-1:1 module mapping against `src/stores/useAccessStore.js`
  `SUBITEM_PERMISSION_MAP`.
- Decide the exact `SYSTEM_BACKUP` action for run/restore (canCreate vs a dedicated flag);
  default to canCreate to avoid a schema change.
- Confirm `apiClient.js` is the sole client request path before requiring `X-Requested-With`.
