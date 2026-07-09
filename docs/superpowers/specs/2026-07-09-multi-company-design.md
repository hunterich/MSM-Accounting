# Multi-Company Support — Design

**Date:** 2026-07-09
**Status:** Approved (design); implementation not started
**Findings closed:** H-5 (org switching / two companies open simultaneously), M-7 (in-app company creation) from the 2026-07-09 app audit
**Branch context:** builds on audit fixes committed in `0964409`

## 1. Goal

The owner runs multiple companies. Today the app hard-binds a login to the user's
first company membership: no switching, no way to work in two companies at once,
and no way to create a company without editing the database. This feature makes
companies first-class:

- Pick a company at login (Accurate-style "database" picker).
- Switch companies from the header without re-logging in.
- Work in two companies **simultaneously — one per browser tab**.
- Create a new company in-app, ready to post immediately.
- Manage which users can access which company, with a role per company.

## 2. Decisions taken (with the owner)

| Decision | Choice |
|---|---|
| Data architecture | **One shared Postgres.** Companies remain `Organization` rows; all tenant tables already carry `organizationId` and isolation was hardened in `0964409`. UI may use Accurate's "database" wording, but physically it is one DB. |
| Simultaneity model | **Two browser tabs**, each pinned to one company. No split-screen. |
| Access model | **Invite per company.** A user is explicitly added to each company with a per-company role (`UserOrganization` + per-org `Role`, both already in schema). |
| New-company bootstrap | **Standard template**: seed-equivalent Indonesian COA, default warehouse, Admin/Finance/POS roles, current-year periods. Not blank, not copy-from-existing. |
| Org-binding mechanism | **Approach A** below. |

## 3. Core mechanism: membership-aware token + per-tab active company

### 3.1 Current state (what we change)

- `lib/auth.ts` `TokenPayload = { userId, orgId, email, roleType }` — org baked in at login.
- `src/app/api/v1/auth/login/route.ts` picks the **first** active membership.
- `src/middleware.ts` copies `payload.orgId` into the `x-org-id` request header; 144
  routes and `lib/rbac` trust `x-org-id` / `x-user-id` / `x-role-type`.
- No switch endpoint; single `msm_token` cookie ⇒ one company per browser.

### 3.2 New model

**Token** (`lib/auth.ts`):

```ts
interface TokenPayload {
  userId: string;
  email: string;
  memberships: Array<{ orgId: string; roleType: string }>; // all ACTIVE memberships
}
```

- Same cookie (`msm_token`), same 8h expiry, same HS256/jose signing.
- `verifyToken` treats a payload **without** `memberships` as invalid ⇒ old tokens
  force one re-login after deploy. No other migration.
- Size note: 5–10 users × a handful of companies each; payload stays far under
  cookie limits.

**Per-request company selection:** the SPA sends `x-active-org: <orgId>` on every
API call. `src/middleware.ts`:

1. Verify token (unchanged, edge-safe — **no Prisma in middleware**).
2. Resolve requested org: `x-active-org` header if present; else, if the token has
   exactly one membership, default to it (keeps curl/scripts and the transition
   simple); else respond `400 { error: 'x-active-org header required' }`.
3. If the requested org is not in `payload.memberships` ⇒
   `403 { error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP' }` —
   the `code` field distinguishes this from ordinary RBAC 403s so the client
   knows to reset to the picker rather than show "no permission".
4. Stamp `x-org-id`, `x-user-id`, `x-role-type` (roleType from the matching
   membership entry) — **always overwriting** any client-supplied values, as today.

Downstream contract is unchanged ⇒ **zero edits to the 144 routes or `lib/rbac`**.
Fine-grained permissions continue to be resolved from the DB per request by the
existing `requirePermission` path; only the coarse `roleType` rides in the token.

**Staleness/security trade-off (accepted):** membership changes take effect on
next token issuance — at worst 8h, immediately on re-login or refresh (below).
Middleware never trusts client `x-org-id` directly; `x-active-org` is only a
*selector* validated against the signed membership list.

### 3.3 Auth endpoints

- `POST /auth/login` — validate credentials; sign token with **all** active
  memberships; response body gains `memberships: [{ orgId, name, roleType }]`
  (org display names for the picker). Zero memberships ⇒ 403 (unchanged).
- `GET /auth/me` — `/api/v1/auth/*` bypasses middleware, so this route reads
  `x-active-org` itself, validates against the token, and returns today's shape
  (org, role, permissions for the **active** org) **plus** `memberships` for the
  switcher.
- `POST /auth/refresh` *(new)* — re-reads the caller's active memberships from
  the DB and re-issues the cookie. Used after creating a company (creator's token
  predates the new membership) and after being invited. Cheap, identity-only.

## 4. Frontend session layer

**Active company per tab:** `sessionStorage['msm-active-org']` (sessionStorage is
per-tab — this is precisely what makes two-tabs-two-companies work).

Bootstrap order on app load: `?org=` URL param (then stripped) → sessionStorage →
auto-select if exactly one membership → otherwise render the **company picker**.
`localStorage['msm-last-org']` is used only to preselect the picker.

- **API client** (`src/api/apiClient.ts`): attach `x-active-org` from
  sessionStorage to every request. A 403 with `code: 'ORG_MEMBERSHIP'` clears the
  stored org and returns to the picker (plain RBAC 403s keep today's behavior).
- **Company picker view** (new, Accurate-style database list): shown post-login
  when memberships > 1, and whenever no valid active org is resolvable.
- **Header switcher:** the static org name in the top bar becomes a dropdown of
  memberships with two actions per company:
  - **Open in new tab** → `window.open('/?org=<id>')` — the new tab pins itself.
  - **Switch here** → write sessionStorage, then `location.assign('/')` — a **hard
    reload**. This deliberately nukes React Query cache, Zustand in-memory state,
    and any in-flight requests: no Company A data can ever render inside Company B.
    (Query keys are not org-aware today — e.g. `AR_KEYS.customers` — and we choose
    the reload over re-keying ~40 hooks.)
- **Persisted-store partitioning:** org-scoped persisted Zustand stores — the
  workspace-tabs store (`useWorkspaceStore`) and org-scoped parts of
  `useSettingsStore` (e.g. dashboard widget layout) — move to storage keys
  suffixed with the active org id (`msm-workspace-<orgId>`), initialized after org
  resolution. Each company keeps its own Accurate-style tab set; two tabs on
  different companies stop sharing workspace state through localStorage.

## 5. Company creation (M-7)

**Bootstrap library** — `lib/organization/bootstrap.ts`:
`bootstrapOrganization(tx, input, creatorUserId)` extracted from `prisma/seed.ts`
so the seed and the wizard share one implementation and cannot drift. Creates, in
one transaction: the `Organization`; the standard Indonesian COA (same accounts the
seed builds — `1-1000 Cash and Bank`, `1-1200 AR`, `2-1100 PPN`, etc., so
`lib/account-defaults.ts` resolves control accounts out of the box); default
warehouse `WH-MAIN`; `Admin` / `Finance` / `POS Operator` roles with the template
permission matrices; twelve current-fiscal-year `AccountingPeriod`s; an active
`UserOrganization` for the creator with the Admin role; and org settings defaults.
Demo data (customers, items, transactions) stays seed-only.

**Endpoint** — `POST /api/v1/organizations`: body `{ legalName, displayName,
npwp?, isPkp?, baseCurrency = 'IDR', timezone = 'Asia/Jakarta',
fiscalYearStart? }`; requires `roleType === 'ADMIN'` in the caller's **active**
org (company creation is an owner/admin capability, not a per-module permission).
Runs the bootstrap transactionally, then the client calls `POST /auth/refresh`
and offers "Open new company now".

**UI** — Settings → **Companies** (new tab, visible to ADMIN): list of the
caller's companies + a "New Company" wizard (single form; the fields above).

## 6. Per-company user access (Phase 4)

Within the **active** company, Settings → Users (already DB-backed) gains:

- **Add existing user to this company**: invite by exact email of an existing
  user → creates `UserOrganization` with a chosen role from this company's roles.
  Creating brand-new users remains the existing Users-tab flow.
- **Remove from this company**: sets `isActive = false` on the membership (soft),
  guarded against removing the company's last active Admin.

Endpoints: `POST /api/v1/users/memberships` `{ email, roleId }` and
`DELETE /api/v1/users/memberships/:id`, both org-scoped via `x-org-id` and
SETTINGS-edit permission. Effect on the invitee's token: next login/refresh.

## 7. Testing

- **Integration (real Postgres, `npm run test:int`):**
  - Request with `x-active-org` for a non-member org ⇒ 403; nothing leaks.
  - One cookie, two orgs: same user reads/writes both orgs' data correctly, and
    each request only touches the org in its header (reuses the two-org seed
    pattern from `tenant-isolation-cross-org.int.test.ts`).
  - Per-org role: user is ADMIN in A, restricted in B ⇒ `x-role-type` differs and
    RBAC outcomes differ per org.
  - Bootstrap completeness: `POST /organizations` yields resolvable control
    accounts via `resolveAccountDefaultId` (AR→1-1200, tax→2-1100 — regression
    ties into the C-3 fix), 12 periods, 3 roles, creator membership; failure
    mid-way rolls back everything.
  - Refresh: membership added ⇒ `POST /auth/refresh` ⇒ new org accessible.
- **E2E (Playwright):** login → picker → open Company A; open second page with
  `?org=B`; create a customer in each; assert neither list shows the other's row.
- **Unit:** middleware org-resolution logic (extracted into a pure helper).

## 8. Phases (each independently shippable)

1. **Backend session core** — token shape, middleware validation, login/me/refresh.
   Ships alone: single-membership users see zero change. *(~1 day)*
2. **Frontend session layer** — per-tab active org, picker, header switcher,
   hard-reload switch, store partitioning. **Delivers the headline need.** *(~1–2 days)*
3. **Company wizard** — bootstrap lib + endpoint + Settings → Companies. *(~1 day)*
4. **Per-company access UI** — membership endpoints + Users-tab additions. *(~0.5–1 day)*

## 9. Explicitly out of scope

- Consolidated cross-company reporting / inter-company eliminations.
- Moving or copying documents between companies.
- Per-company subdomains or separate deployments.
- Copy-COA-from-existing-company wizard option (template only, per decision).
- Live token revocation (accepted ≤8h staleness; re-login is the manual override).

## 10. Risks & plan-time verification items

- **Frontend code that assumes a single org**: audit uses of
  `useAuthStore(...).org` and any module reading org at import time; all must go
  through the resolved active org. (Plan task.)
- **Recurring runners** (`recurring-invoices/run`, `recurring-bills/run`, backup
  cron): verify how they obtain org scope — they must iterate orgs or take the
  org from the authenticated request, never default to "first org". (Plan task.)
- **POS offline storage (Dexie)**: verify per-org keying before Phase 2 lands, or
  POS tabs in different companies could mix queues. (Plan task.)
- **`?org=` bootstrap param**: must be consumed and stripped before router
  navigation so deep links keep working. (Plan task.)
- **Vite dev-server staleness** (observed during the audit): after large
  multi-file changes, restart the dev server before browser-verifying.
