# Server-Side RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the existing per-role permission matrix on the server for every state-changing API route (and sensitive reads), so the browser's permission gating can no longer be bypassed by calling the API directly.

**Architecture:** A Node-runtime authorization helper (`requirePermission`) reads the caller's role permissions (already in `RolePermission`) per request and throws 403 when the action isn't allowed; a `withPermission(descriptor, handler)` wrapper applies it declaratively per route, reusing `withHandler`'s error handling. A central `ROUTE_PERMISSIONS` table is the single source of truth, and a completeness test fails the build if any mutating route is left unguarded. Plus four small auth-hardening fixes (backup permission, org-settings lock, OAuth nonce, CSRF header, cookie secure).

**Tech Stack:** Next.js (App Router, Node runtime route handlers), Prisma, Vitest, `jose`, `google-auth-library`.

---

## Reference: existing facts (do not re-derive)

- Middleware `src/middleware.ts` verifies the JWT and injects trustworthy `x-org-id`/`x-user-id`/`x-role-type`. Routes read these via `req.headers.get(...)`.
- `lib/api-utils.ts`: `withHandler`, `requireOrg`, `requireAuth`, `ApiError` (re-exported from `lib/errors.ts`), `ok`, `err`.
- `lib/approval/can-approve.ts`: `userCanApprove(db, orgId, userId, roleType, moduleKey)` — the exact lookup pattern to generalize. ADMIN returns true; otherwise `userOrganization.findFirst({ where: { userId, organizationId: orgId } }).role.permissions[0]`.
- Prisma `ModuleKey` enum (server source of truth, 25 values): DASHBOARD, GL_COA, GL_JOURNAL, AR_INVOICES, AR_SALES_ORDERS, AR_PAYMENTS, AR_CREDITS, AR_CUSTOMERS, AP_POS, AP_BILLS, AP_PAYMENTS, AP_DEBITS, AP_VENDORS, INV_ITEMS, INV_CATEGORIES, INV_ADJ, HR_EMPLOYEES, HR_ATTENDANCE, HR_PAYROLL, BANKING, INTEGRATIONS, REPORTS, COMPANY, SETTINGS, SYSTEM_BACKUP.
- `RolePermission`: columns `canView, canCreate, canEdit, canDelete, canApprove`.
- `RoleType`: ADMIN (bypass), ACCOUNTANT, VIEWER, CUSTOM.
- Test command: `npm test` (Vitest, unit). Integration: `npm run test:int`. Typecheck: `npm run typecheck` (run `npm run prisma:generate` first if Prisma types are stale — shared cross-worktree client).
- Commit frequently to branch `claude/server-side-rbac` (shared-checkout clobber mitigation). Before each commit run `git rev-parse --abbrev-ref HEAD` and, if it isn't `claude/server-side-rbac`, run `git checkout claude/server-side-rbac` first.

## File Structure

- **Create** `lib/authz.ts` — `Action` type, `requirePermission`, `authActor`, `withPermission`. One responsibility: authorization.
- **Create** `lib/__tests__/authz.test.ts` — unit tests for the helper/wrapper.
- **Create** `src/app/api/v1/__tests__/route-permission-coverage.test.ts` — the completeness guard.
- **Create** `src/app/api/v1/__tests__/authz-enforcement.test.ts` — behavioral 403/allow tests for high-risk routes.
- **Modify** ~150 `src/app/api/v1/**/route.ts` — wrap mutating handlers (+ sensitive-read GETs) with `withPermission`.
- **Modify** `src/app/api/v1/auth/google/route.ts`, `src/views/Login.tsx` — OAuth nonce.
- **Modify** `lib/auth.ts` or login/google routes + `src/api/apiClient.js` — CSRF header; cookie `secure`.

---

## Action-mapping rules

Default by method: `GET→view`, `POST→create`, `PUT/PATCH→edit`, `DELETE→delete`. Overrides:

| Sub-route | Action |
|---|---|
| `.../void` | delete |
| `.../post`, `.../calculate`, `.../receive`, `.../generate`, `.../run`, `.../convert`, `.../activate`, `.../dispose`, `.../match`, `.../finalize`, `.../close` | create (finalizing/posting) unless noted |
| `.../unreceive`, `.../reopen`, `.../cancel`, `.../submit`, `.../submit-approval`, `.../send-email` | edit |
| `approvals/[id]/approve`/`reject`, `invoices|purchase-orders/[id]/approve`/`reject` | approve |

**Module mapping for resources without a 1:1 enum key** (stricter-or-equal to the UI; documented):
- assets, asset-categories, assets/depreciation, assets/[id]/activate|dispose → `GL_JOURNAL` (asset accounting posts to the GL).
- accounting-periods, email-templates, import/[entity], inventory/recalculate-costing, subscription-plans, subscriptions, users → `SETTINGS`.
- customer-categories → `AR_CUSTOMERS`; vendor-categories → `AP_VENDORS`.
- departments, positions, leave-balances, leave-requests, leave-types → `HR_ATTENDANCE` (HR config/leave).
- delivery-notes → `AR_SALES_ORDERS`; recurring-invoices → `AR_INVOICES`; recurring-bills → `AP_BILLS`.
- bank-accounts, bank-statements, bank-transactions, reconciliation → `BANKING`.
- warehouses → `INV_ITEMS`; bill-imports → `AP_BILLS`; email/reminders → `AR_INVOICES`; inventory/valuation → `REPORTS`.

**Enforced-read GETs** (sensitive; everything else GET stays authenticated-only/open): `audit-logs`, `backup/history`, `backup/[id]/download`, `payroll-runs` (list + `[id]`), `employees` (list + `[id]`), `reports/*`, `inventory/valuation`.

**Open (authenticated-only) — allowlisted in the coverage test, NOT wrapped:**
- All `auth/*` (public/self), all `OPTIONS` handlers.
- `users/me/password` POST (self-service own-password change).
- Reference/lookup reads used cross-module: every other `GET`, plus the non-mutating lookups `item-categories/[id]/next-sku` (POST that only computes), `purchase-orders/billable-lines` (GET).
- `approvals/[id]/approve` + `reject` (already guarded by `assertApprovalAuthorized`; allowlist with comment).

---

## Task 1: Authorization helper `requirePermission`

**Files:**
- Create: `lib/authz.ts`
- Test: `lib/__tests__/authz.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/authz.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: { userOrganization: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import { requirePermission, authActor } from '../authz';
import { ApiError } from '../errors';

function req(headers: Record<string, string>) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

beforeEach(() => { findFirst.mockReset(); });

describe('requirePermission', () => {
  it('allows ADMIN without any DB lookup', async () => {
    await expect(
      requirePermission(req({ 'x-org-id': 'o1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' }), 'HR_PAYROLL', 'create'),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('allows when the role grants the action', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ canView: true, canCreate: true, canEdit: false, canDelete: false, canApprove: false }] } });
    await expect(
      requirePermission(req({ 'x-org-id': 'o1', 'x-user-id': 'u2', 'x-role-type': 'CUSTOM' }), 'AR_INVOICES', 'create'),
    ).resolves.toBeUndefined();
  });

  it('throws 403 when the role lacks the action', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false }] } });
    await expect(
      requirePermission(req({ 'x-org-id': 'o1', 'x-user-id': 'u3', 'x-role-type': 'VIEWER' }), 'AR_INVOICES', 'create'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('throws 403 (fail-closed) when there is no membership/permission row', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      requirePermission(req({ 'x-org-id': 'o1', 'x-user-id': 'u4', 'x-role-type': 'CUSTOM' }), 'GL_JOURNAL', 'delete'),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('throws 401 when identity headers are missing', async () => {
    await expect(requirePermission(req({}), 'GL_JOURNAL', 'view')).rejects.toMatchObject({ status: 401 });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- lib/__tests__/authz.test.ts`
Expected: FAIL — `Cannot find module '../authz'`.

- [ ] **Step 3: Implement `lib/authz.ts` (helper portion)**

```ts
import type { NextRequest } from 'next/server';
import type { ModuleKey, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve';

type Db = Prisma.TransactionClient | typeof prisma;

const COLUMN: Record<Action, keyof { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canApprove: boolean }> = {
  view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete', approve: 'canApprove',
};

export function authActor(req: NextRequest): { orgId: string; userId: string; roleType: string } {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  const roleType = req.headers.get('x-role-type') ?? '';
  if (!orgId || !userId) throw new ApiError('Unauthenticated', 401);
  return { orgId, userId, roleType };
}

/** Throws ApiError(403) unless the caller's role allows `action` on `moduleKey`. ADMIN bypasses. */
export async function requirePermission(
  req: NextRequest,
  moduleKey: ModuleKey,
  action: Action,
  db: Db = prisma,
): Promise<void> {
  const { orgId, userId, roleType } = authActor(req);
  if (roleType === 'ADMIN') return;

  const membership = await db.userOrganization.findFirst({
    where: { userId, organizationId: orgId, isActive: true },
    select: { role: { select: { permissions: { where: { moduleKey }, select: { canView: true, canCreate: true, canEdit: true, canDelete: true, canApprove: true } } } } },
  });

  const allowed = membership?.role.permissions[0]?.[COLUMN[action]] ?? false;
  if (!allowed) {
    throw new ApiError(`Forbidden: missing ${action} permission for ${moduleKey}`, 403);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- lib/__tests__/authz.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/authz.ts lib/__tests__/authz.test.ts
git commit -m "feat(authz): add requirePermission helper"
```

---

## Task 2: `withPermission` route wrapper

**Files:**
- Modify: `lib/authz.ts`
- Test: `lib/__tests__/authz.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to authz.test.ts)**

```ts
import { withPermission } from '../authz';
import { NextResponse } from 'next/server';

describe('withPermission', () => {
  it('runs the handler when permitted (ADMIN)', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withPermission({ module: 'AR_INVOICES', action: 'create' }, handler);
    const res = await wrapped(req({ 'x-org-id': 'o1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' }) as any);
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it('returns 403 and does NOT run the handler when denied', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ canCreate: false }] } });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withPermission({ module: 'AR_INVOICES', action: 'create' }, handler);
    const res = await wrapped(req({ 'x-org-id': 'o1', 'x-user-id': 'u3', 'x-role-type': 'VIEWER' }) as any);
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('supports a dynamic descriptor function', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withPermission(() => ({ module: 'GL_JOURNAL', action: 'delete' }), handler);
    const res = await wrapped(req({ 'x-org-id': 'o1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' }) as any);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `npm test -- lib/__tests__/authz.test.ts` → FAIL (`withPermission` not exported).

- [ ] **Step 3: Implement `withPermission` (append to `lib/authz.ts`)**

```ts
import type { NextResponse } from 'next/server';
import { withHandler } from '@/lib/api-utils';

type Descriptor = { module: ModuleKey; action: Action };

export function withPermission<TContext = unknown>(
  descriptor: Descriptor | ((req: NextRequest, ctx: TContext) => Descriptor),
  handler: (req: NextRequest, ctx: TContext) => Promise<NextResponse>,
) {
  return withHandler<TContext>(async (req, ctx) => {
    const d = typeof descriptor === 'function' ? descriptor(req, ctx) : descriptor;
    await requirePermission(req, d.module, d.action);
    return handler(req, ctx);
  });
}
```

Note: `withHandler` converts the thrown `ApiError(403)` into a 403 JSON response, so denied requests never reach `handler`.

- [ ] **Step 4: Run, verify pass** — `npm test -- lib/__tests__/authz.test.ts` → PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/authz.ts lib/__tests__/authz.test.ts
git commit -m "feat(authz): add withPermission route wrapper"
```

---

## Task 3: Completeness guard test (write FIRST, expect many failures)

This test encodes `ROUTE_PERMISSIONS` coverage. Write it now so it drives Tasks 4–9; it will fail until every route is wrapped.

**Files:**
- Create: `src/app/api/v1/__tests__/route-permission-coverage.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';            // if unavailable, use 'glob' or fast-glob already in devDeps
import path from 'node:path';

// Routes intentionally NOT permission-wrapped (public/self/lookup). Keep this list tight.
const OPEN_ALLOWLIST = new Set([
  'auth/google/route.ts', 'auth/login/route.ts', 'auth/logout/route.ts', 'auth/me/route.ts',
  'users/me/password/route.ts',
  'item-categories/[id]/next-sku/route.ts',
  'purchase-orders/billable-lines/route.ts',
  'approvals/[id]/approve/route.ts', 'approvals/[id]/reject/route.ts', 'approvals/route.ts',
]);

// GET handlers we DO enforce (sensitive reads). All other GET-only files may stay open.
const ENFORCED_READS = new Set([
  'audit-logs/route.ts', 'backup/history/route.ts', 'backup/[id]/download/route.ts',
  'payroll-runs/route.ts', 'payroll-runs/[id]/route.ts',
  'employees/route.ts', 'employees/[id]/route.ts',
  'reports/ap/route.ts', 'reports/ar/route.ts', 'reports/banking/route.ts',
  'reports/gl/route.ts', 'reports/hr/route.ts', 'reports/sales/route.ts',
  'inventory/valuation/route.ts',
]);

const ROOT = path.resolve(__dirname, '..');
const files = globSync('**/route.ts', { cwd: ROOT }).filter((f) => !f.startsWith('__tests__'));

describe('route permission coverage', () => {
  for (const rel of files) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    const hasMutation = /export\s+(const|async function)\s+(POST|PUT|PATCH|DELETE)\b/.test(src);
    const isEnforcedRead = ENFORCED_READS.has(rel);
    const needsGuard = (hasMutation || isEnforcedRead) && !OPEN_ALLOWLIST.has(rel);

    it(`${rel} is permission-guarded`, () => {
      if (!needsGuard) return;          // open/lookup/public — fine
      expect(src.includes('withPermission'), `${rel} must use withPermission`).toBe(true);
    });
  }
});
```

(If `node:fs` has no `globSync` in this Node version, import from the `glob`/`fast-glob` dev dependency already present, or fall back to a small recursive `readdirSync` walk.)

- [ ] **Step 2: Run, observe failures**

Run: `npm test -- src/app/api/v1/__tests__/route-permission-coverage.test.ts`
Expected: many FAIL (every unwrapped mutating route). This is the worklist for Tasks 4–9.

- [ ] **Step 3: Commit the guard**

```bash
git add src/app/api/v1/__tests__/route-permission-coverage.test.ts
git commit -m "test(authz): add route permission coverage guard (currently red)"
```

---

## Tasks 4–9: Apply `withPermission` per domain

For EACH route file: for every mutating handler (and enforced-read GET), wrap it. Conversion pattern:

**Before (withHandler):**
```ts
export const POST = withHandler(async (req: NextRequest) => { ... });
```
**After:**
```ts
import { withPermission } from '@/lib/authz';
export const POST = withPermission({ module: 'AR_INVOICES', action: 'create' }, async (req: NextRequest) => { ... });
```

**Before (raw handler, e.g. payroll post):**
```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { ...body... }
```
**After:**
```ts
export const POST = withPermission(
  { module: 'HR_PAYROLL', action: 'create' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => { ...body... },
);
```
(Drop the now-redundant inner `try/catch` that only re-threw `ApiError`; `withHandler` covers it. Keep any handler-specific logic.)

After each domain task: run `npm test -- src/app/api/v1/__tests__/route-permission-coverage.test.ts` and commit when that domain's files go green.

### Task 4 — General Ledger & Banking
| File | Handler → descriptor |
|---|---|
| `journal-entries/route.ts` | POST→`{GL_JOURNAL,create}` |
| `journal-entries/[id]/route.ts` | PUT→`{GL_JOURNAL,edit}`, DELETE→`{GL_JOURNAL,delete}` |
| `accounts/route.ts` | POST→`{GL_COA,create}` |
| `accounts/[id]/route.ts` | PUT→`{GL_COA,edit}`, DELETE→`{GL_COA,delete}` |
| `accounting-periods/route.ts` | POST→`{SETTINGS,create}` |
| `accounting-periods/[id]/route.ts` | PUT→`{SETTINGS,edit}`, DELETE→`{SETTINGS,delete}` |
| `accounting-periods/[id]/close/route.ts` | POST→`{SETTINGS,edit}` |
| `bank-accounts/route.ts` | POST→`{BANKING,create}` |
| `bank-accounts/[id]/route.ts` | PUT→`{BANKING,edit}`, DELETE→`{BANKING,delete}` |
| `bank-transactions/route.ts` | POST→`{BANKING,create}` |
| `bank-transactions/[id]/route.ts` | PUT→`{BANKING,edit}`, DELETE→`{BANKING,delete}` |
| `bank-statements/route.ts` | POST→`{BANKING,create}` |
| `bank-statements/[lineId]/route.ts` | PUT→`{BANKING,edit}` |
| `bank-statements/match/route.ts` | POST→`{BANKING,edit}` |
| `reconciliation/payments/match/route.ts` | POST→`{BANKING,edit}` |

Behavioral test (add to Task 10): VIEWER POST `/journal-entries` → 403.

### Task 5 — Accounts Receivable
| File | Handler → descriptor |
|---|---|
| `invoices/route.ts` | POST→`{AR_INVOICES,create}` |
| `invoices/[id]/route.ts` | PUT→`{AR_INVOICES,edit}`, DELETE→`{AR_INVOICES,delete}` |
| `invoices/[id]/void/route.ts` | POST→`{AR_INVOICES,delete}` |
| `invoices/[id]/send-email/route.ts` | POST→`{AR_INVOICES,edit}` |
| `invoices/[id]/submit-approval/route.ts` | POST→`{AR_INVOICES,edit}` |
| `invoices/[id]/approve/route.ts` | POST→`{AR_INVOICES,approve}` |
| `invoices/[id]/reject/route.ts` | POST→`{AR_INVOICES,approve}` |
| `sales-orders/route.ts` | POST→`{AR_SALES_ORDERS,create}` |
| `sales-orders/[id]/route.ts` | PUT→`{AR_SALES_ORDERS,edit}`, DELETE→`{AR_SALES_ORDERS,delete}` |
| `sales-orders/[id]/convert/route.ts` | POST→`{AR_SALES_ORDERS,create}` |
| `ar-payments/route.ts` | POST→`{AR_PAYMENTS,create}` |
| `ar-payments/[id]/route.ts` | PUT→`{AR_PAYMENTS,edit}`, DELETE→`{AR_PAYMENTS,delete}` |
| `ar-payments/[id]/void/route.ts` | POST→`{AR_PAYMENTS,delete}` |
| `credit-notes/route.ts` | POST→`{AR_CREDITS,create}` |
| `credit-notes/[id]/route.ts` | PUT→`{AR_CREDITS,edit}`, DELETE→`{AR_CREDITS,delete}` |
| `credit-notes/[id]/void/route.ts` | POST→`{AR_CREDITS,delete}` |
| `sales-returns/route.ts` | POST→`{AR_CREDITS,create}` |
| `sales-returns/[id]/route.ts` | PUT→`{AR_CREDITS,edit}`, DELETE→`{AR_CREDITS,delete}` |
| `sales-returns/[id]/void/route.ts` | POST→`{AR_CREDITS,delete}` |
| `customers/route.ts` | POST→`{AR_CUSTOMERS,create}` |
| `customers/[id]/route.ts` | PUT→`{AR_CUSTOMERS,edit}`, DELETE→`{AR_CUSTOMERS,delete}` |
| `customer-categories/route.ts` | POST→`{AR_CUSTOMERS,create}` |
| `customer-categories/[id]/route.ts` | PUT→`{AR_CUSTOMERS,edit}`, DELETE→`{AR_CUSTOMERS,delete}` |
| `recurring-invoices/route.ts` | POST→`{AR_INVOICES,create}` |
| `recurring-invoices/[id]/route.ts` | PUT→`{AR_INVOICES,edit}`, DELETE→`{AR_INVOICES,delete}` |
| `recurring-invoices/[id]/generate/route.ts` | POST→`{AR_INVOICES,create}` |
| `recurring-invoices/run/route.ts` | POST→`{AR_INVOICES,create}` |
| `delivery-notes/route.ts` | POST→`{AR_SALES_ORDERS,create}` |
| `email/reminders/route.ts` | POST→`{AR_INVOICES,edit}` |

### Task 6 — Accounts Payable
| File | Handler → descriptor |
|---|---|
| `bills/route.ts` | POST→`{AP_BILLS,create}` |
| `bills/[id]/route.ts` | PUT→`{AP_BILLS,edit}`, DELETE→`{AP_BILLS,delete}` |
| `bills/[id]/void/route.ts` | POST→`{AP_BILLS,delete}` |
| `bills/[id]/unreceive/route.ts` | POST→`{AP_BILLS,edit}` |
| `bill-imports/route.ts` | POST→`{AP_BILLS,create}` |
| `bill-imports/[id]/route.ts` | PUT→`{AP_BILLS,edit}` |
| `bill-imports/[id]/finalize/route.ts` | POST→`{AP_BILLS,create}` |
| `purchase-orders/route.ts` | POST→`{AP_POS,create}` |
| `purchase-orders/[id]/route.ts` | PUT→`{AP_POS,edit}`, DELETE→`{AP_POS,delete}` |
| `purchase-orders/[id]/receive/route.ts` | POST→`{AP_POS,create}` |
| `purchase-orders/[id]/close/route.ts` | POST→`{AP_POS,edit}` |
| `purchase-orders/[id]/send-email/route.ts` | POST→`{AP_POS,edit}` |
| `purchase-orders/[id]/submit-approval/route.ts` | POST→`{AP_POS,edit}` |
| `purchase-orders/[id]/approve/route.ts` | POST→`{AP_POS,approve}` |
| `purchase-orders/[id]/reject/route.ts` | POST→`{AP_POS,approve}` |
| `ap-payments/route.ts` | POST→`{AP_PAYMENTS,create}` |
| `ap-payments/[id]/route.ts` | PUT→`{AP_PAYMENTS,edit}`, DELETE→`{AP_PAYMENTS,delete}` |
| `ap-payments/[id]/void/route.ts` | POST→`{AP_PAYMENTS,delete}` |
| `debit-notes/route.ts` | POST→`{AP_DEBITS,create}` |
| `debit-notes/[id]/route.ts` | PUT→`{AP_DEBITS,edit}`, DELETE→`{AP_DEBITS,delete}` |
| `debit-notes/[id]/void/route.ts` | POST→`{AP_DEBITS,delete}` |
| `purchase-returns/route.ts` | POST→`{AP_DEBITS,create}` |
| `purchase-returns/[id]/route.ts` | PUT→`{AP_DEBITS,edit}`, DELETE→`{AP_DEBITS,delete}` |
| `purchase-returns/[id]/void/route.ts` | POST→`{AP_DEBITS,delete}` |
| `vendors/route.ts` | POST→`{AP_VENDORS,create}` |
| `vendors/[id]/route.ts` | PUT→`{AP_VENDORS,edit}`, DELETE→`{AP_VENDORS,delete}` |
| `vendor-categories/route.ts` | POST→`{AP_VENDORS,create}` |
| `vendor-categories/[id]/route.ts` | PUT→`{AP_VENDORS,edit}`, DELETE→`{AP_VENDORS,delete}` |
| `recurring-bills/route.ts` | POST→`{AP_BILLS,create}` |
| `recurring-bills/[id]/route.ts` | PUT→`{AP_BILLS,edit}`, DELETE→`{AP_BILLS,delete}` |
| `recurring-bills/[id]/generate/route.ts` | POST→`{AP_BILLS,create}` |
| `recurring-bills/run/route.ts` | POST→`{AP_BILLS,create}` |

### Task 7 — Inventory & Assets
| File | Handler → descriptor |
|---|---|
| `items/route.ts` | POST→`{INV_ITEMS,create}` |
| `items/[id]/route.ts` | PUT→`{INV_ITEMS,edit}`, DELETE→`{INV_ITEMS,delete}` |
| `item-categories/route.ts` | POST→`{INV_CATEGORIES,create}` |
| `item-categories/[id]/route.ts` | PUT→`{INV_CATEGORIES,edit}`, DELETE→`{INV_CATEGORIES,delete}` |
| `warehouses/route.ts` | POST→`{INV_ITEMS,create}` |
| `warehouses/[id]/route.ts` | PUT→`{INV_ITEMS,edit}`, DELETE→`{INV_ITEMS,delete}` |
| `stock-adjustments/route.ts` | POST→`{INV_ADJ,create}` |
| `stock-adjustments/[id]/route.ts` | PUT→`{INV_ADJ,edit}`, DELETE→`{INV_ADJ,delete}` |
| `stock-adjustments/[id]/void/route.ts` | POST→`{INV_ADJ,delete}` |
| `stock-counts/route.ts` | POST→`{INV_ADJ,create}` |
| `stock-counts/[id]/route.ts` | PUT→`{INV_ADJ,edit}` |
| `stock-counts/[id]/submit/route.ts` | POST→`{INV_ADJ,edit}` |
| `stock-counts/[id]/post/route.ts` | POST→`{INV_ADJ,create}` |
| `stock-counts/[id]/cancel/route.ts` | POST→`{INV_ADJ,edit}` |
| `stock-counts/[id]/reopen/route.ts` | POST→`{INV_ADJ,edit}` |
| `inventory/recalculate-costing/route.ts` | POST→`{SETTINGS,edit}` |
| `inventory/valuation/route.ts` | GET→`{REPORTS,view}` (enforced read) |
| `assets/route.ts` | POST→`{GL_JOURNAL,create}` |
| `assets/[id]/route.ts` | PUT→`{GL_JOURNAL,edit}`, DELETE→`{GL_JOURNAL,delete}` |
| `assets/[id]/activate/route.ts` | POST→`{GL_JOURNAL,create}` |
| `assets/[id]/dispose/route.ts` | POST→`{GL_JOURNAL,create}` |
| `assets/depreciation/run/route.ts` | POST→`{GL_JOURNAL,create}` |
| `asset-categories/route.ts` | POST→`{GL_JOURNAL,create}` |
| `asset-categories/[id]/route.ts` | PUT→`{GL_JOURNAL,edit}`, DELETE→`{GL_JOURNAL,delete}` |

### Task 8 — HR & Payroll
| File | Handler → descriptor |
|---|---|
| `employees/route.ts` | GET→`{HR_EMPLOYEES,view}` (enforced read), POST→`{HR_EMPLOYEES,create}` |
| `employees/[id]/route.ts` | GET→`{HR_EMPLOYEES,view}`, PUT→`{HR_EMPLOYEES,edit}`, DELETE→`{HR_EMPLOYEES,delete}` |
| `attendance/route.ts` | POST→`{HR_ATTENDANCE,create}` |
| `attendance/[id]/route.ts` | PUT→`{HR_ATTENDANCE,edit}`, DELETE→`{HR_ATTENDANCE,delete}` |
| `payroll-runs/route.ts` | GET→`{HR_PAYROLL,view}` (enforced read), POST→`{HR_PAYROLL,create}` |
| `payroll-runs/[id]/route.ts` | GET→`{HR_PAYROLL,view}`, PUT→`{HR_PAYROLL,edit}`, DELETE→`{HR_PAYROLL,delete}` |
| `payroll-runs/[id]/calculate/route.ts` | POST→`{HR_PAYROLL,create}` |
| `payroll-runs/[id]/post/route.ts` | POST→`{HR_PAYROLL,create}` |
| `departments/route.ts` | POST→`{HR_ATTENDANCE,create}` |
| `departments/[id]/route.ts` | PUT→`{HR_ATTENDANCE,edit}`, DELETE→`{HR_ATTENDANCE,delete}` |
| `positions/route.ts` | POST→`{HR_ATTENDANCE,create}` |
| `positions/[id]/route.ts` | PUT→`{HR_ATTENDANCE,edit}`, DELETE→`{HR_ATTENDANCE,delete}` |
| `leave-balances/route.ts` | POST→`{HR_ATTENDANCE,create}` |
| `leave-requests/route.ts` | POST→`{HR_ATTENDANCE,create}` |
| `leave-requests/[id]/route.ts` | PUT→`{HR_ATTENDANCE,edit}`, DELETE→`{HR_ATTENDANCE,delete}` |
| `leave-types/route.ts` | POST→`{HR_ATTENDANCE,create}` |
| `leave-types/[id]/route.ts` | PUT→`{HR_ATTENDANCE,edit}`, DELETE→`{HR_ATTENDANCE,delete}` |

### Task 9 — Settings, Backup, Integrations, Reports, Audit, Subscriptions
| File | Handler → descriptor |
|---|---|
| `organization/settings/route.ts` | PUT→`{SETTINGS,edit}` (GET stays open) |
| `audit-logs/route.ts` | GET→`{SETTINGS,view}` (enforced read) |
| `users/route.ts` | GET→`{SETTINGS,view}` (replaces raw ADMIN check) |
| `users/[id]/reset-password/route.ts` | POST→`{SETTINGS,edit}` (replaces raw ADMIN check) |
| `backup/run/route.ts` | POST→`{SYSTEM_BACKUP,create}` (replaces raw ADMIN check) |
| `backup/[id]/restore/route.ts` | POST→`{SYSTEM_BACKUP,create}` |
| `backup/[id]/download/route.ts` | GET→`{SYSTEM_BACKUP,view}` (enforced read) |
| `backup/history/route.ts` | GET→`{SYSTEM_BACKUP,view}` (enforced read) |
| `backup/settings/route.ts` | GET→`{SYSTEM_BACKUP,view}`, PUT→`{SYSTEM_BACKUP,edit}` |
| `integrations/route.ts` | POST→`{INTEGRATIONS,create}` |
| `integrations/[id]/route.ts` | PUT→`{INTEGRATIONS,edit}`, DELETE→`{INTEGRATIONS,delete}` |
| `import/[entity]/route.ts` | POST→`{SETTINGS,create}` |
| `reports/ap|ar|banking|gl|hr|sales/route.ts` | GET→`{REPORTS,view}` (enforced reads, all six) |
| `email-templates/route.ts` | POST→`{SETTINGS,create}` |
| `email-templates/[id]/route.ts` | PUT→`{SETTINGS,edit}`, DELETE→`{SETTINGS,delete}` |
| `subscription-plans/route.ts` | POST→`{SETTINGS,create}` |
| `subscription-plans/[id]/route.ts` | PUT→`{SETTINGS,edit}`, DELETE→`{SETTINGS,delete}` |
| `subscriptions/route.ts` | POST→`{SETTINGS,create}` |
| `subscriptions/[id]/route.ts` | PUT→`{SETTINGS,edit}` |
| `subscriptions/[id]/cancel/route.ts` | POST→`{SETTINGS,edit}` |
| `subscriptions/generate-invoices/route.ts` | POST→`{SETTINGS,create}` |

For the routes that previously hand-rolled `if (x-role-type !== 'ADMIN') return err(...403)` (`users/*`, `backup/*`), **remove** that line and rely on `withPermission` (ADMIN still bypasses, and now `SYSTEM_BACKUP`/`SETTINGS` holders are also honored). Keep the `restoreBackupInputSchema` "type RESTORE to confirm" check.

- [ ] After Tasks 4–9: run `npm test -- src/app/api/v1/__tests__/route-permission-coverage.test.ts` → **PASS (all green)**. Commit each domain as you finish it:
```bash
git add src/app/api/v1/<domain>/ && git commit -m "feat(authz): enforce permissions on <domain> routes"
```

---

## Task 10: Behavioral enforcement tests (representative high-risk routes)

**Files:**
- Create: `src/app/api/v1/__tests__/authz-enforcement.test.ts`

- [ ] **Step 1: Write tests** mirroring the existing route-test harness (see `journal-entries-decimal.test.ts` / `operations.validation.test.ts` for the mocking style). Mock `@/lib/prisma` `userOrganization.findFirst` to return a role lacking the action; assert 403 and that the underlying create/post mock was NOT called. Cover at minimum:
  - `payroll-runs/[id]/post` — VIEWER → 403, `postPayrollRunToLedger` not called; ADMIN header → proceeds.
  - `journal-entries` POST — role without `canCreate` on GL_JOURNAL → 403.
  - `invoices/[id]/void` — role without `canDelete` on AR_INVOICES → 403.
  - `accounts/[id]` DELETE — role without `canDelete` on GL_COA → 403.
  - `organization/settings` PUT — role without `canEdit` on SETTINGS → 403.
  - `backup/[id]/restore` — role without `canCreate` on SYSTEM_BACKUP → 403; ADMIN → passes the permission gate.

```ts
// shape (repeat per route):
it('blocks a viewer from posting payroll', async () => {
  vi.mocked(prisma.userOrganization.findFirst).mockResolvedValue({
    role: { permissions: [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false }] },
  } as never);
  const res = await postPayroll(makeReq('/api/v1/payroll-runs/p1/post', 'org-a', 'POST', {}, { 'x-role-type': 'VIEWER' }),
    { params: Promise.resolve({ id: 'p1' }) });
  expect(res.status).toBe(403);
  expect(postPayrollRunToLedger).not.toHaveBeenCalled();
});
```

(Extend the local `makeReq` helper to set `x-role-type`; default existing tests to `'ADMIN'` so they keep passing — see Task 11.)

- [ ] **Step 2: Run** `npm test -- src/app/api/v1/__tests__/authz-enforcement.test.ts` → PASS.
- [ ] **Step 3: Commit** `git commit -am "test(authz): behavioral 403 enforcement for high-risk routes"`.

---

## Task 11: Fix existing route tests broken by enforcement

Existing route tests send `x-org-id`/`x-user-id` but not `x-role-type`, so they now hit non-ADMIN denial. 

- [ ] **Step 1:** In each existing API test's request helper (`makeReq`/`makePostReq`/`makePutReq` in `src/app/api/v1/__tests__/*.test.ts`), add header `'x-role-type': 'ADMIN'` by default. ADMIN bypasses `requirePermission`, so no per-test permission mocking is needed and the tests assert business logic as before.
- [ ] **Step 2:** Run the full unit suite: `npm test`. Fix any stragglers (a test that specifically needs a non-admin can mock `userOrganization.findFirst`).
- [ ] **Step 3: Commit** `git commit -am "test: default route tests to ADMIN role for authz"`.

---

## Task 12: Hardening — org-settings already covered; now Google OAuth nonce

**Files:**
- Modify: `src/app/api/v1/auth/google/route.ts`
- Modify: `src/views/Login.tsx`

- [ ] **Step 1:** In `Login.tsx`, generate a random nonce (`crypto.randomUUID()`), store it (e.g. `sessionStorage`), pass `nonce` to the Google button/`useGoogleLogin` config, and include it in the POST body to `/auth/google`.
- [ ] **Step 2:** In `auth/google/route.ts`, after `verifyIdToken`, read `ticket.getPayload().nonce` and compare to the nonce from the request body; mismatch → `err('Invalid login nonce', 401)`.
- [ ] **Step 3:** Add a unit test in the google route test (or create one) asserting a mismatched nonce → 401.
- [ ] **Step 4:** Run `npm test -- auth` ; **Step 5:** commit `git commit -am "fix(auth): bind Google login with a nonce"`.

---

## Task 13: Hardening — CSRF header + cookie secure

**Files:**
- Modify: `src/api/apiClient.js` (send `X-Requested-With: msm` on all requests)
- Modify: `src/middleware.ts` (reject mutating methods lacking the header)
- Modify: `src/app/api/v1/auth/login/route.ts`, `auth/google/route.ts` (cookie `secure`)

- [ ] **Step 1 (CSRF):** In `apiClient.js`, add header `'X-Requested-With': 'msm'` to every request. In `middleware.ts`, for methods in `{POST,PUT,PATCH,DELETE}` on `/api/v1/*` (excluding `/api/v1/auth/login` and `/api/v1/auth/google`, which are the initial unauthenticated calls), if `req.headers.get('x-requested-with') !== 'msm'` return `withCors(NextResponse.json({ error: 'Missing CSRF header' }, { status: 403 }))`. Place this check AFTER token verification.
- [ ] **Step 2 (cookie):** Replace `secure: process.env.NODE_ENV === 'production'` with `secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'` in both login and google routes. Add `COOKIE_SECURE` to `.env.example` with a comment (set `true` behind HTTPS in non-prod).
- [ ] **Step 3:** Update/verify any test that exercises middleware or login cookie. Run `npm test`.
- [ ] **Step 4:** Manual note for verification: confirm the dev frontend (`apiClient`) sends the header so the app still works end-to-end.
- [ ] **Step 5:** Commit `git commit -am "fix(auth): add CSRF header check and HTTPS-aware cookie secure"`.

---

## Task 14: Full verification

- [ ] **Step 1:** `npm run prisma:generate` (ensure fresh client), then `npm run typecheck` → no errors.
- [ ] **Step 2:** `npm test` → entire unit suite green (incl. coverage guard + enforcement + existing).
- [ ] **Step 3:** `npm run test:int` (real-Postgres GL-invariant suite) → green (needs the `_test` DB; `npm run test:int:setup` first if needed).
- [ ] **Step 4:** Start the app (frontend + backend per `scripts/dev-setup.sh`), log in as the seeded admin, and smoke-test one create + one read to confirm the CSRF header and permissions don't break the happy path. Capture proof.
- [ ] **Step 5:** Final commit / summary; do NOT push or open a PR unless the user asks.

---

## Self-review notes

- **Spec coverage:** §1 helper→Task 1; §2 wrapper→Task 2; §3 mapping→Tasks 4–9 (table); §4 reads policy→ENFORCED_READS/OPEN_ALLOWLIST in Task 3 + GET rows in Tasks 7–9; §5 hardening→Tasks 9 (backup/org-settings),12 (OAuth),13 (CSRF/cookie); §6 completeness→Task 3. All covered.
- **Module-mapping deviations from the client** (assets→GL_JOURNAL, categories→parent master, periods/import/costing/subscriptions→SETTINGS, leave/dept/positions→HR_ATTENDANCE) are stricter-or-equal to the UI and are documented in the mapping section; a cleaner future option is adding `ASSETS` to the `ModuleKey` enum (migration) so server/client align exactly.
- **Risk control:** ADMIN bypass keeps the owner unblocked; existing tests default to ADMIN (Task 11); the coverage guard prevents missed routes; verification runs the full suite + integration + a live smoke test.
