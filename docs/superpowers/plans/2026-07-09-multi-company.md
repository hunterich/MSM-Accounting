# Multi-Company Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one login work across multiple companies — pick at login, switch from the header, run two companies in two browser tabs simultaneously, create companies in-app, and manage per-company user access.

**Architecture:** The JWT stops carrying a single `orgId` and instead carries the user's full membership list; each browser tab sends its active company as an `x-active-org` header which the middleware validates against the signed list before stamping the same `x-org-id`/`x-user-id`/`x-role-type` headers all routes already trust. Company creation extracts the seed's template data into a shared bootstrap library. Spec: `docs/superpowers/specs/2026-07-09-multi-company-design.md`.

**Tech Stack:** Next.js API routes + `jose` JWT (edge middleware), Prisma/Postgres (no schema changes), React 19 + Vite SPA, Zustand, React Query, Vitest (unit + integration vs real Postgres), Playwright.

**Conventions for every task:**
- Repo root: the worktree root. `@/lib` resolves to root `lib/`. Frontend lives in `src/`, backend routes in `src/app/api/v1/`.
- Read every file fully before editing. Match existing style. No `git push`.
- Unit tests: `npm test` (or `npx vitest run <file>` for one file). Integration: `npm run test:int` (needs local `_test` Postgres — it is reachable in this environment). Typecheck: `npm run typecheck`.
- Commit after each task with the message given in the task.

---

## Phase 1 — Backend session core

### Task 1: Token shape + pure org-resolution helper (`lib/auth.ts`)

**Files:**
- Modify: `lib/auth.ts`
- Test: `lib/__tests__/auth-org-resolution.test.ts` (create)

- [ ] **Step 1: Write the failing unit tests**

Create `lib/__tests__/auth-org-resolution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveActiveOrg, type TokenPayload } from '../auth';

const payload: TokenPayload = {
  userId: 'u1',
  email: 'a@b.c',
  memberships: [
    { orgId: 'org-a', roleType: 'ADMIN' },
    { orgId: 'org-b', roleType: 'FINANCE' },
  ],
};

describe('resolveActiveOrg', () => {
  it('picks the requested org when the user is a member', () => {
    expect(resolveActiveOrg(payload, 'org-b')).toEqual({
      ok: true, orgId: 'org-b', roleType: 'FINANCE',
    });
  });

  it('rejects an org the user is not a member of', () => {
    expect(resolveActiveOrg(payload, 'org-evil')).toEqual({
      ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP',
    });
  });

  it('defaults to the sole membership when no header is sent', () => {
    const single: TokenPayload = { ...payload, memberships: [payload.memberships[0]] };
    expect(resolveActiveOrg(single, null)).toEqual({
      ok: true, orgId: 'org-a', roleType: 'ADMIN',
    });
  });

  it('requires the header when the user has multiple memberships', () => {
    expect(resolveActiveOrg(payload, null)).toEqual({
      ok: false, status: 400, error: 'x-active-org header required', code: 'ORG_REQUIRED',
    });
  });

  it('rejects a payload with no memberships', () => {
    const none: TokenPayload = { ...payload, memberships: [] };
    expect(resolveActiveOrg(none, 'org-a')).toEqual({
      ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/__tests__/auth-org-resolution.test.ts` → FAIL (`resolveActiveOrg` not exported).

- [ ] **Step 3: Implement in `lib/auth.ts`**

Replace the `TokenPayload` interface and add the helper (keep `COOKIE_NAME`, `EXPIRY`, `signToken`, `getSecret` as-is):

```ts
export interface OrgMembershipClaim {
  orgId: string;
  roleType: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  memberships: OrgMembershipClaim[];
}

export type ActiveOrgResolution =
  | { ok: true; orgId: string; roleType: string }
  | { ok: false; status: 400 | 403; error: string; code: 'ORG_REQUIRED' | 'ORG_MEMBERSHIP' };

/** Pure, edge-safe resolution of the tab's requested org against the signed membership list. */
export function resolveActiveOrg(payload: TokenPayload, requestedOrgId: string | null): ActiveOrgResolution {
  const memberships = payload.memberships ?? [];
  const requested = requestedOrgId ?? (memberships.length === 1 ? memberships[0].orgId : null);
  if (!requested) {
    return { ok: false, status: 400, error: 'x-active-org header required', code: 'ORG_REQUIRED' };
  }
  const match = memberships.find((m) => m.orgId === requested);
  if (!match) {
    return { ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP' };
  }
  return { ok: true, orgId: match.orgId, roleType: match.roleType };
}
```

In `verifyToken`, after `jwtVerify` succeeds, reject legacy tokens:

```ts
const candidate = payload as unknown as TokenPayload;
if (!Array.isArray(candidate.memberships)) return null; // pre-multi-company token → force re-login
return candidate;
```

- [ ] **Step 4: Run tests** — same command → 5 PASS. Expect `npm run typecheck` to now FAIL in login/google/me routes and middleware (they still build the old payload) — that is Task 2/3's job; do NOT fix here.

- [ ] **Step 5: Commit** — `git add lib/auth.ts lib/__tests__/auth-org-resolution.test.ts && git commit -m "feat(auth): membership-aware token payload + resolveActiveOrg helper"`

### Task 2: Middleware validates `x-active-org`

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Rewrite the post-verify section of `middleware()`**

After the existing `verifyToken` block, replace the header-stamping with:

```ts
import { verifyToken, resolveActiveOrg, COOKIE_NAME } from '../lib/auth';
// ...
const resolution = resolveActiveOrg(payload, req.headers.get('x-active-org'));
if (!resolution.ok) {
  return withCors(NextResponse.json(
    { error: resolution.error, code: resolution.code },
    { status: resolution.status },
  ));
}

const requestHeaders = new Headers(req.headers);
requestHeaders.set('x-user-id', payload.userId);   // always overwrite — never trust client values
requestHeaders.set('x-org-id', resolution.orgId);
requestHeaders.set('x-role-type', resolution.roleType);

return withCors(NextResponse.next({ request: { headers: requestHeaders } }));
```

Also add `x-active-org` to the allowed CORS request headers: in `lib/cors.ts`, extend `Access-Control-Allow-Headers` to `'Content-Type, Authorization, x-active-org'`.

- [ ] **Step 2: Typecheck** — `npm run typecheck`. Middleware itself must be clean; remaining failures should only be the auth routes (fixed next).

- [ ] **Step 3: Commit** — `git add src/middleware.ts lib/cors.ts && git commit -m "feat(auth): middleware resolves x-active-org against membership claims"`

### Task 3: Login + Google routes sign the membership list

**Files:**
- Modify: `src/app/api/v1/auth/login/route.ts`
- Modify: `src/app/api/v1/auth/google/route.ts`

- [ ] **Step 1: Update `login/route.ts`**

Change the memberships query to fetch ALL active memberships (drop `take: 1`, keep the ordering and includes). Then replace the single-membership logic:

```ts
const memberships = user.memberships; // all active
if (memberships.length === 0) {
  return withCors(NextResponse.json({ error: 'No organization found for user' }, { status: 403 }));
}

const token = await signToken({
  userId: user.id,
  email: user.email,
  memberships: memberships.map((m) => ({ orgId: m.organizationId, roleType: m.role.roleType })),
});
```

Response body: keep today's shape for the FIRST membership (so single-org clients behave identically — `org`, `role`, `needsInventoryValuationSetup`, `mustChangePassword` computed from `memberships[0]` exactly as before) and ADD:

```ts
memberships: memberships.map((m) => ({
  orgId: m.organizationId,
  name: m.organization.displayName,
  roleType: m.role.roleType,
})),
```

Cookie handling is unchanged (same `response.cookies.set(...)` call as today — copy its exact options).

- [ ] **Step 2: Update `google/route.ts` identically** — read it fully first; it has the same pick-first-membership + `signToken` pattern. Apply the same all-memberships query, `signToken` payload, and `memberships` response field.

- [ ] **Step 3: Verify** — `npm run typecheck` (auth/me will still fail → next task), then live: restart backend is NOT needed (Next dev hot-reloads); run:
`curl -s -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"admin@demo.com","password":"admin123"}' | head -c 400` → response includes `"memberships":[{"orgId":"org-demo",...}]`.

- [ ] **Step 4: Commit** — `git add src/app/api/v1/auth/login/route.ts src/app/api/v1/auth/google/route.ts && git commit -m "feat(auth): login/google issue membership-list tokens"`

### Task 4: `/auth/me` becomes org-aware

**Files:**
- Modify: `src/app/api/v1/auth/me/route.ts`

- [ ] **Step 1: Rework the handler** (this route bypasses middleware, so it resolves the org itself):

```ts
const payload = await verifyToken(token);
if (!payload) return withCors(NextResponse.json({ error: 'Invalid token' }, { status: 401 }));

const resolution = resolveActiveOrg(payload, req.headers.get('x-active-org'));

const user = await prisma.user.findUnique({
  where: { id: payload.userId },
  include: {
    memberships: {
      where: { isActive: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      include: { role: { include: { permissions: true } }, organization: true },
    },
  },
});
if (!user) return withCors(NextResponse.json({ error: 'User not found' }, { status: 404 }));

const membershipsOut = user.memberships.map((m) => ({
  orgId: m.organizationId,
  name: m.organization.displayName,
  roleType: m.role.roleType,
}));

if (!resolution.ok) {
  // No/invalid active org: return identity + memberships so the client can show the picker.
  return withCors(NextResponse.json({
    user: { id: user.id, email: user.email, fullName: user.fullName },
    memberships: membershipsOut,
    org: null,
    needsOrgSelection: true,
    mustChangePassword: user.mustChangePassword === true,
  }));
}

const membership = user.memberships.find((m) => m.organizationId === resolution.orgId);
if (!membership) return withCors(NextResponse.json({ error: 'Membership not found' }, { status: 403 }));
```

Then build the SAME response shape as today (org/role/permissions/needsInventoryValuationSetup/mustChangePassword) from `membership`, plus `memberships: membershipsOut`.

- [ ] **Step 2: Verify live**

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"admin@demo.com","password":"admin123"}' -c /tmp/mc.txt >/dev/null
curl -s http://localhost:3000/api/v1/auth/me -b /tmp/mc.txt -H "x-active-org: org-demo" | head -c 300   # → org payload for org-demo
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/customers -b /tmp/mc.txt -H "x-active-org: org-evil"   # → 403 (middleware)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/customers -b /tmp/mc.txt   # → 200 (single membership defaults)
```

- [ ] **Step 3: Typecheck + unit suite** — `npm run typecheck` clean; `npm test` green (fix any auth-route test mocks that assumed the old payload — search `src/app/api/v1/__tests__` for login/me tests and update expected shapes only).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(auth): org-aware /auth/me with memberships + picker signal"`

### Task 5: `POST /auth/refresh`

**Files:**
- Create: `src/app/api/v1/auth/refresh/route.ts`

- [ ] **Step 1: Implement** — verify the existing cookie, re-read active memberships from DB, re-issue the cookie:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, signToken, COOKIE_NAME } from '@/lib/auth';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

  const memberships = await prisma.userOrganization.findMany({
    where: { userId: payload.userId, isActive: true },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    include: { role: { select: { roleType: true } }, organization: { select: { displayName: true } } },
  });
  if (memberships.length === 0) {
    return withCors(NextResponse.json({ error: 'No organization found for user' }, { status: 403 }));
  }

  const fresh = await signToken({
    userId: payload.userId,
    email: payload.email,
    memberships: memberships.map((m) => ({ orgId: m.organizationId, roleType: m.role.roleType })),
  });

  const response = NextResponse.json({
    memberships: memberships.map((m) => ({
      orgId: m.organizationId, name: m.organization.displayName, roleType: m.role.roleType,
    })),
  });
  // copy the exact cookie options used by login/route.ts
  response.cookies.set(COOKIE_NAME, fresh, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 });
  return withCors(response);
}
```

(Before committing, open `login/route.ts` and mirror its exact `cookies.set` options — including `secure` if present.)

- [ ] **Step 2: Verify live** — `curl -s -X POST http://localhost:3000/api/v1/auth/refresh -b /tmp/mc.txt -c /tmp/mc2.txt | head -c 200` → memberships list + new `msm_token` in `/tmp/mc2.txt`.

- [ ] **Step 3: Commit** — `git add src/app/api/v1/auth/refresh/route.ts && git commit -m "feat(auth): POST /auth/refresh re-issues membership token"`

### Task 6: Phase-1 integration test (two orgs, one cookie)

**Files:**
- Create: `lib/__tests__/integration/multi-org-session.int.test.ts`

- [ ] **Step 1: Write it** — follow the seeding pattern of `lib/__tests__/integration/tenant-isolation-cross-org.int.test.ts` (it already builds two orgs + users + roles). Seed ONE user with ACTIVE memberships in BOTH orgs (ADMIN role in A, a restricted role in B). Because int tests bypass middleware, drive the exported route handlers with stamped headers the way that file does, and additionally cover the middleware contract through `resolveActiveOrg` directly:
  - `resolveActiveOrg(tokenPayloadFor(user), 'org-b')` → ok, roleType of B.
  - `resolveActiveOrg(tokenPayloadFor(user), 'org-c')` → 403 `ORG_MEMBERSHIP`.
  - Call the customers GET handler once with `x-org-id: <orgA>` and once with `<orgB>` (same user id header) → each returns only its own org's rows.
  - Call `/auth/refresh` handler with a request whose cookie is a signed token for the user → response memberships has both orgs.
- [ ] **Step 2: Run** — `npm run test:int` → all green including the new file.
- [ ] **Step 3: Commit** — `git add lib/__tests__/integration/multi-org-session.int.test.ts && git commit -m "test(auth): multi-org session integration coverage"`

---

## Phase 2 — Frontend session layer

### Task 7: Active-org module (`src/lib/activeOrg.ts`)

**Files:**
- Create: `src/lib/activeOrg.ts`
- Test: `src/lib/__tests__/activeOrg.test.ts` (create; vitest with jsdom is already configured for `src`)

- [ ] **Step 1: Failing tests** — cover: returns null when unset; set/get round-trip; `bootstrapActiveOrg()` consumes `?org=` (sets sessionStorage, strips the param via `history.replaceState`, records `msm-last-org` in localStorage); `clearActiveOrg()` removes the sessionStorage key.

- [ ] **Step 2: Implement**

```ts
const SESSION_KEY = 'msm-active-org';
const LAST_KEY = 'msm-last-org';

export function getActiveOrgId(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function setActiveOrgId(orgId: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, orgId);
    localStorage.setItem(LAST_KEY, orgId);
  } catch { /* private mode — header simply won't persist across reloads */ }
}

export function clearActiveOrg(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}

export function getLastOrgId(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

/** Consume ?org= (open-in-new-tab handshake) BEFORE the router mounts. */
export function bootstrapActiveOrg(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('org');
    if (fromUrl) {
      setActiveOrgId(fromUrl);
      url.searchParams.delete('org');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch { /* noop */ }
  return getActiveOrgId();
}
```

- [ ] **Step 3: Call `bootstrapActiveOrg()` in `src/main.tsx`** as the first statement before React renders.
- [ ] **Step 4: Run tests + typecheck** → green. **Commit:** `git commit -m "feat(session): per-tab active-org module with ?org= bootstrap"`

### Task 8: API client sends the header; membership-403 resets to picker

**Files:**
- Modify: `src/api/apiClient.ts`
- Modify: `src/stores/useAuthStore.ts` (its raw `fetch` calls)

- [ ] **Step 1: `apiClient.ts`** — in `apiFetch`, merge the header and handle the coded 403:

```ts
import { getActiveOrgId, clearActiveOrg } from '../lib/activeOrg';
// inside apiFetch, before fetch():
const activeOrg = getActiveOrgId();
const orgHeader = activeOrg ? { 'x-active-org': activeOrg } : {};
// merge orgHeader into the headers passed to fetch (both FormData and JSON branches)

// inside the !res.ok branch, after parsing body:
if (res.status === 403 && (body as { code?: string }).code === 'ORG_MEMBERSHIP') {
  clearActiveOrg();
  window.location.assign('/'); // back through bootstrap → picker
}
```

- [ ] **Step 2: `useAuthStore.ts`** — `checkSession` adds `headers: { ...(getActiveOrgId() ? { 'x-active-org': getActiveOrgId()! } : {}) }` to its `/auth/me` fetch. Extend the store state with `memberships: Array<{ orgId: string; name: string; roleType: string }>` (default `[]`), `needsOrgSelection: boolean` (default false), populated from the login/me responses; add a `selectOrg(orgId: string)` action that calls `setActiveOrgId(orgId)` and re-runs `checkSession()`.
- [ ] **Step 3: Typecheck + unit tests** → green. **Commit:** `git commit -m "feat(session): x-active-org on every request + membership-403 reset"`

### Task 9: Company picker view + routing gate

**Files:**
- Create: `src/views/CompanyPicker.tsx`
- Modify: `src/App.tsx` (or `src/components/auth/ProtectedRoute.tsx` — whichever gates authed content; read both and pick the single chokepoint)

- [ ] **Step 1: Picker component** — a centered card listing `memberships` from `useAuthStore` (company name + roleType badge), Accurate-database-list style; `getLastOrgId()` preselected/highlighted; clicking a company calls `selectOrg(orgId)`. Reuse `Card`/`Button` from `src/components/UI`.
- [ ] **Step 2: Gate** — in the auth chokepoint: if session is authenticated AND (`needsOrgSelection` OR (`!getActiveOrgId()` && `memberships.length > 1`)) → render `<CompanyPicker />` instead of the app. Single-membership users never see it (me-route defaulting keeps `org` populated).
- [ ] **Step 3: Verify in browser** (dev servers on 5173/3000; restart the Vite server first — known staleness gotcha): with only org-demo existing this must be a NO-OP (login lands on dashboard as today). Screenshot dashboard to confirm no regression.
- [ ] **Step 4: Commit** — `git commit -m "feat(session): company picker for multi-membership users"`

### Task 10: Header company switcher

**Files:**
- Modify: `src/components/Layout/Layout.tsx` (org name at line ~34)
- Create: `src/components/Layout/CompanySwitcher.tsx`

- [ ] **Step 1: `CompanySwitcher.tsx`** — replace the static `<span>{org?.name}</span>` with a dropdown (follow the existing header dropdown pattern in `Layout.tsx` if one exists; otherwise a simple `useState`-toggled absolute-positioned menu with an outside-click close). Contents: one row per membership — company name, roleType, a check on the active one — and per row two actions:
  - **Switch here**: `setActiveOrgId(m.orgId); window.location.assign('/');` (hard reload wipes RQ cache + Zustand).
  - **Open in new tab** (icon button): `window.open(`/?org=${m.orgId}`, '_blank')`.
  Hide the dropdown chrome entirely when `memberships.length <= 1` (render today's plain text).
- [ ] **Step 2: Verify in browser** — single-org: header looks unchanged. (Multi-org behavior gets its real test in Task 15 once a second company can exist.)
- [ ] **Step 3: Commit** — `git commit -m "feat(session): header company switcher (switch-here / open-in-new-tab)"`

### Task 11: Per-org workspace persistence + single-org-assumption sweep

**Files:**
- Modify: `src/stores/useWorkspaceStore.ts` (persist `name: 'msm-workspace'` at ~line 199)
- Sweep: all `sessionStorage`/`localStorage` users under `src/` that hold org-scoped data

- [ ] **Step 1: Org-scoped storage adapter** — in `useWorkspaceStore.ts`, keep the static `name` but wrap storage so keys are partitioned per org at call time:

```ts
import { createJSONStorage } from 'zustand/middleware';
import { getActiveOrgId } from '../lib/activeOrg';

const orgScopedStorage = {
  getItem: (k: string) => localStorage.getItem(`${k}:${getActiveOrgId() ?? 'default'}`),
  setItem: (k: string, v: string) => localStorage.setItem(`${k}:${getActiveOrgId() ?? 'default'}`, v),
  removeItem: (k: string) => localStorage.removeItem(`${k}:${getActiveOrgId() ?? 'default'}`),
};
// in persist options: storage: createJSONStorage(() => orgScopedStorage),
```

(Because switching is always a hard reload, the active org is stable for the lifetime of the store — no rehydration juggling needed.)
- [ ] **Step 2: Sweep for other single-org assumptions** — `grep -rn "localStorage\|sessionStorage" src/ --include="*.ts" --include="*.tsx" -l` and inspect each hit: partition org-scoped state (dashboard widget layout in `useSettingsStore` gets the same adapter), leave org-agnostic state (theme, auth) alone. Also `grep -rn "useAuthStore.getState().org" src/` — every use must tolerate the picker phase (org null). Check `src/db/` for Dexie (POS offline): if a Dexie DB stores org data, its database name must include the org id — report findings; fix if ≤ ~20 lines, otherwise flag in the commit message.
- [ ] **Step 3: Tests + typecheck + browser sanity** (dashboard + workspace tabs still restore). **Commit:** `git commit -m "feat(session): per-org partitioning of persisted client state"`

---

## Phase 3 — Company creation

### Task 12: Bootstrap library (extract template from seed)

**Files:**
- Create: `lib/organization/bootstrap.ts`
- Modify: `prisma/seed.ts`
- Test: `lib/__tests__/integration/org-bootstrap.int.test.ts` (create)

- [ ] **Step 1: Extract template data.** Move from `prisma/seed.ts` into `lib/organization/bootstrap.ts` as exported constants (exact same content — cut/paste, then import back into the seed):
  - `ALL_MODULE_KEYS` (seed.ts:6) → export.
  - `rootAccountsData` (seed.ts:327) and `childAccountsData` (seed.ts:347) → export as `STANDARD_ROOT_ACCOUNTS` / `STANDARD_CHILD_ACCOUNTS`.
  - The three role definitions + permission matrices (Admin ~:73-121, POS Operator ~:122-163, Cashier ~:164-250) → export a `ROLE_TEMPLATES` array `{ name, roleType, permissions: Array<{ moduleKey, canView, canCreate, canEdit, canDelete, canApprove }> }` capturing exactly what the seed's `createMany`/`updateMany` calls produce today (trace them carefully — the `updateMany` calls refine specific modules after the initial matrix).
  `prisma/seed.ts` then imports these constants and keeps its own upsert loops — seed behavior must be byte-identical (verify: `npm run db:seed` still succeeds against the dev DB… run it ONLY IF the dev DB is already seeded demo data — it is idempotent by design).
- [ ] **Step 2: Implement `bootstrapOrganization`** in the same file — create-only, transaction-scoped:

```ts
export interface BootstrapOrgInput {
  legalName: string;
  displayName: string;
  npwp?: string | null;
  isPkp?: boolean;
  baseCurrency?: string;   // default 'IDR'
  timezone?: string;       // default 'Asia/Jakarta'
  fiscalYearStart?: Date | null;
}

export async function bootstrapOrganization(
  tx: Prisma.TransactionClient,
  input: BootstrapOrgInput,
  creatorUserId: string,
): Promise<{ orgId: string }> { /* … */ }
```

Inside, in order: create `Organization` (defaults per schema); create root then child accounts from the two constants (children linked by parent code, `isPostable` flags exactly as the seed sets them); create warehouse `{ code: 'WH-MAIN', name: 'Gudang Utama' }`; create the three roles + `rolePermission.createMany` from `ROLE_TEMPLATES`; create 12 `AccountingPeriod` rows for the fiscal year starting at `fiscalYearStart ?? Jan 1 of the current year` (name `YYYY-MM`, status OPEN); create `userOrganization { userId: creatorUserId, roleId: <Admin role id>, isActive: true }`.
- [ ] **Step 3: Integration test** — in a transaction against the `_test` DB: run `bootstrapOrganization`, then assert: account count equals `STANDARD_ROOT_ACCOUNTS.length + STANDARD_CHILD_ACCOUNTS.length`; `resolveAccountDefaultId(accounts, undefined, 'arControl')` → the `1-1200` account and `'arTax'` → `2-1100` (ties into the C-3 regression); 12 periods; 3 roles with Admin having full SYSTEM/SETTINGS rights; exactly one active membership for the creator. Second test: make the tx throw after org creation (pass an input that violates a constraint, e.g. duplicate warehouse insertion forced via a spy, or simply run inside `$transaction` and `throw` after calling bootstrap) → org row does not exist afterward (rollback).
- [ ] **Step 4: Run** — `npm run test:int` + `npm test` + `npm run typecheck` green. **Commit:** `git commit -m "feat(org): shared bootstrap library extracted from seed template"`

### Task 13: `POST /api/v1/organizations`

**Files:**
- Create: `src/app/api/v1/organizations/route.ts`
- Test: extend `lib/__tests__/integration/org-bootstrap.int.test.ts`

- [ ] **Step 1: Route** — follow the codebase's route conventions (`withHandler`/`ApiError` from `lib/api-utils.ts` or the withCors/NextResponse style of nearby routes — read `src/app/api/v1/warehouses/route.ts` as the reference). Guard: `req.headers.get('x-role-type') === 'ADMIN'` else 403 (`{ error: 'Only administrators can create companies' }`). Validate body with zod (`legalName` ≥ 2 chars, `displayName` ≥ 2 chars, optional npwp/isPkp/fiscalYearStart ISO date). Execute `prisma.$transaction((tx) => bootstrapOrganization(tx, input, req.headers.get('x-user-id')!))`, `logAudit` with `action: 'CREATE'`, `entityType: 'Organization'`, and return `201 { orgId }`.
- [ ] **Step 2: Integration test** — call the handler with ADMIN headers → 201 + bootstrap-complete assertions (reuse Task 12 helpers); call with `x-role-type: FINANCE` → 403 and no org created.
- [ ] **Step 3: Live verify** — with `/tmp/mc.txt` cookie: `curl -s -X POST http://localhost:3000/api/v1/organizations -b /tmp/mc.txt -H "Content-Type: application/json" -H "x-active-org: org-demo" -d '{"legalName":"PT Uji Coba","displayName":"PT Uji Coba"}'` → 201; then `POST /auth/refresh` → memberships now lists two orgs; then `GET /api/v1/accounts -H "x-active-org: <newOrgId>"` → the standard COA.
- [ ] **Step 4: Commit** — `git commit -m "feat(org): POST /organizations creates a bootstrapped company (ADMIN only)"`

### Task 14: Settings → Companies UI

**Files:**
- Modify: `src/views/settings/*` (read `src/views/settings` to find the Settings tab registry — follow how existing tabs like Users are registered)
- Create: `src/views/settings/Companies.tsx`

- [ ] **Step 1: Companies tab** — visible only when `roleType === 'ADMIN'`. Renders: (a) a table of the caller's memberships (name, your role, active badge on current org); (b) a **New Company** form (displayName, legalName, NPWP, PKP checkbox, fiscal year start date — defaults mirroring the endpoint). Submit → `api.post('/api/v1/organizations', form)` → on success `api.post('/api/v1/auth/refresh')` → `checkSession()` → toast with an **Open now** action that runs `window.open('/?org=' + orgId)`.
- [ ] **Step 2: Browser verify end-to-end (the headline demo):** create "PT Uji Coba" via the UI → header switcher now lists 2 companies → **Open in new tab** → new tab shows PT Uji Coba with empty dashboard/COA seeded; original tab still on PT. Demo Accounting. Screenshot both tabs.
- [ ] **Step 3: Commit** — `git commit -m "feat(org): Settings→Companies tab with New Company wizard"`

---

## Phase 4 — Per-company user access

### Task 15: Membership endpoints

**Files:**
- Create: `src/app/api/v1/users/memberships/route.ts` (POST)
- Create: `src/app/api/v1/users/memberships/[id]/route.ts` (DELETE)
- Test: `lib/__tests__/integration/memberships-admin.int.test.ts` (create)

- [ ] **Step 1: POST** — `withPermission({ module: 'SETTINGS', action: 'edit' }, ...)` (mirror `src/app/api/v1/users/route.ts` conventions). Body `{ email, roleId }`. Logic: find user by exact email (404 `'User not found'` if absent — invitee must already exist); validate `roleId` belongs to `x-org-id` (`validateForeignKey(prisma.role, { id: roleId, organizationId: orgId }, ...)`); upsert `userOrganization` on `@@unique([userId, organizationId])` — if an inactive membership exists reactivate it with the new role, if active return 409 `'User is already a member'`; `logAudit`; 201.
- [ ] **Step 2: DELETE `[id]`** — fetch the membership WITH `organizationId: orgId` filter (404 otherwise — cross-org guard). **Last-admin guard:** if the target membership's role has `roleType === 'ADMIN'`, count other ACTIVE memberships in this org whose role is ADMIN; if zero → 422 `'Cannot remove the last administrator'`. Otherwise set `isActive: false`; `logAudit`; 200.
- [ ] **Step 3: Integration tests** — two-org seed: invite existing user by email with org-B roleId while scoped to org-A → 404/422 (FK validation); happy-path invite → membership active, refresh handler now returns both orgs for the invitee; re-invite active → 409; deactivate → `isActive false`; removing the only admin → 422.
- [ ] **Step 4: Run + commit** — suites green; `git commit -m "feat(org): per-company membership endpoints with last-admin guard"`

### Task 16: Users tab — access management UI

**Files:**
- Modify: the Settings Users view (locate via `grep -rn "useUsers" src/views/settings/`)

- [ ] **Step 1: UI** — per the existing Users table conventions add: an **"Add user to this company"** button (modal: email input + role select populated from the org's roles via the existing roles hook) calling the POST endpoint; a per-row **"Remove from company"** action calling DELETE, disabled with a tooltip for your own row and for the last admin (server enforces regardless). Surface the server's 409/422 messages as toasts.
- [ ] **Step 2: Browser verify** — in PT Uji Coba (new tab): add `cashier@demo.com` with a role → cashier logs in (fresh login → picker with 2 companies). Remove them → their next refresh loses access (`ORG_MEMBERSHIP` 403 → picker).
- [ ] **Step 3: Commit** — `git commit -m "feat(org): Users tab per-company access management"`

---

## Final gate (after Task 16) — COMPLETED 2026-07-10

- [x] `npm run typecheck` && `npm test` && `npm run test:int` — all green on the combined tree
      (typecheck clean, 786 unit, 190 int + 1 pre-existing expected-fail).
- [x] Two-tab simultaneity + isolation verified against the live backend: one login/cookie,
      concurrent customer creates in two orgs via `x-active-org`, each list contains only its
      own row (Demo 9 / Uji Coba 1, no cross-visibility). Browser-verified equivalents:
      company picker, header switcher round-trip (Demo Rp75M vs new-company Rp0), `?org=`
      new-tab handshake, rejected-pin bounce hint. Playwright spec not added — the live
      two-tab proof plus the cross-org integration suite cover the same assertions.
- [x] Live regression sweep of audit fixes: C-1 concurrent double-send → exactly one journal
      entry; C-2 concurrent oversell (5 on hand, two sales of 4) → one 200 / one 422, stock
      ends at 1, never negative. Both still hold with the new org header in play.
- [x] Recurring-runner org-scope check (spec §10): `recurring-invoices/run` and
      `recurring-bills/run` both derive scope from `requireOrg(req)` and filter every query by
      `organizationId` — no first-org assumption; multi-company safe as-is. Backup/restore is
      whole-database (`pg_dump` over DATABASE_URL, `pg_restore --clean`), an inherent
      consequence of the shared-DB decision — documented in spec §9a.
- [x] Membership endpoint guards verified live: cross-org roleId → 404; cross-org DELETE → 404
      with victim row untouched; sole-admin removal → 422; **concurrent removal of both admins
      → one 200 / one 422 with an admin surviving** (proves the advisory lock).
- [x] Update memory (`project_multi_company_feature.md`) with final state.

Known follow-ups (not blocking): POS offline Dexie DB (`pharmacy-pos`) is not org-keyed and the
POS entrypoint has no picker/bootstrap — fix before running two companies from one POS machine.
Existing users get one forced re-login (token shape) and a one-time reset of locally cached
workspace tabs / dashboard layout; HR picklists and saved report presets are orphaned under the
old un-suffixed localStorage keys.

## Sequencing / risk notes for the executor

- Tasks 1–5 temporarily break `npm run typecheck` BETWEEN commits (payload shape ripples). Land them in order in one sitting; the suite must be fully green again by end of Task 4.
- After Phase 1 lands, the running backend invalidates existing browser sessions (old token shape) — re-login in the preview browser before any UI verification.
- The Vite dev server has shown stale-transform behavior after multi-file writes: restart it (`preview_stop`/`preview_start`) before browser-verifying Phases 2–4.
- Do not run `npm run prisma:generate` (no schema changes) and never `git push`.
