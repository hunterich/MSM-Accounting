# Admin Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an `ADMIN` reset any real DB user's password from inside the app, forcing that user to choose a new password on next login, plus a self-service "change my password" flow.

**Architecture:** Three new endpoints under `/api/v1/users/*` (so Next.js middleware injects `x-user-id`/`x-org-id`/`x-role-type`). A new `User.mustChangePassword` boolean drives a blocking forced-change screen rendered by `ProtectedRoute`. A shared `passwordSchema` (min 8, ≥1 letter, ≥1 number) validates every new password. Frontend uses a React Query hook (`useUsers`) and three small auth components. Admin gating reuses the existing `x-role-type === 'ADMIN'` convention.

**Tech Stack:** Next.js 15 API routes, Prisma + PostgreSQL, Zod, bcryptjs, React 19 + React Router 7, Zustand, React Query v5, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-admin-password-reset-design.md`

---

## File Structure

**Backend (create):**
- `src/app/api/v1/users/route.ts` — `GET` admin-only real-user list
- `src/app/api/v1/users/[id]/reset-password/route.ts` — `POST` admin reset
- `src/app/api/v1/users/me/password/route.ts` — `POST` self-service change

**Backend (modify):**
- `prisma/schema.prisma` — add `User.mustChangePassword`
- `lib/api-utils.ts` — widen `AuditOpts.action` union
- `lib/password.ts` — add shared `passwordSchema`
- `src/app/api/v1/auth/login/route.ts` — return `mustChangePassword`
- `src/app/api/v1/auth/me/route.ts` — return `mustChangePassword`

**Frontend (create):**
- `src/hooks/useUsers.ts` — React Query hooks
- `src/components/auth/ChangePasswordModal.tsx` — self-service modal
- `src/components/auth/ForcedPasswordChange.tsx` — full-screen forced screen
- `src/components/auth/ResetPasswordModal.tsx` — admin reset modal

**Frontend (modify):**
- `src/stores/useAuthStore.ts` — `mustChangePassword` state + `clearMustChangePassword`
- `src/components/auth/ProtectedRoute.tsx` — render forced screen when flag set
- `src/components/Layout/Layout.tsx` — "Change Password" menu entry
- `src/views/settings/SecurityRolesTab.tsx` — "Login Accounts" card

**Tests (create):**
- `lib/__tests__/password.test.ts`
- `src/app/api/v1/__tests__/users-list.test.ts`
- `src/app/api/v1/__tests__/users-reset-password.test.ts`
- `src/app/api/v1/__tests__/users-me-password.test.ts`

---

## Task 1: Schema field + audit action union

No unit test (schema/types). Verified by `prisma validate` and `tsc`.

**Files:**
- Modify: `prisma/schema.prisma` (User model, around line 98)
- Modify: `lib/api-utils.ts:32`

- [ ] **Step 1: Add the schema field**

In `prisma/schema.prisma`, inside `model User`, add the field after `passwordHash`:

```prisma
  passwordHash   String?
  mustChangePassword Boolean @default(false)
```

- [ ] **Step 2: Widen the audit action union**

In `lib/api-utils.ts`, change the `AuditOpts` type's `action` (line 32). `AuditLog.action` is a plain `String` column, so this needs no migration:

```ts
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VOID' | 'RESET_PASSWORD' | 'CHANGE_PASSWORD';
```

- [ ] **Step 3: Regenerate Prisma client + push schema**

Run:
```bash
npm run prisma:generate && npx prisma db push
```
Expected: `prisma generate` succeeds; `db push` reports the database is in sync (adds the `mustChangePassword` column).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no NEW errors in `lib/api-utils.ts` or schema-derived types. (A pre-existing `lib/backup/scheduler.ts` "Cannot find module 'node-cron'" error is unrelated; ignore it.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma lib/api-utils.ts
git commit -m "feat(auth): add User.mustChangePassword + password audit actions"
```

---

## Task 2: Shared password policy validator

**Files:**
- Modify: `lib/password.ts`
- Test: `lib/__tests__/password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { passwordSchema } from '../password';

describe('passwordSchema', () => {
  it('accepts a password with letters and numbers, min 8 chars', () => {
    expect(passwordSchema.safeParse('secret123').success).toBe(true);
  });

  it('rejects fewer than 8 characters', () => {
    const r = passwordSchema.safeParse('ab12');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/8 characters/);
  });

  it('rejects letters-only', () => {
    const r = passwordSchema.safeParse('onlyletters');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/number/);
  });

  it('rejects numbers-only', () => {
    const r = passwordSchema.safeParse('12345678');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/letter/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/__tests__/password.test.ts`
Expected: FAIL — `passwordSchema` is not exported.

- [ ] **Step 3: Implement the validator**

In `lib/password.ts`, add at the top (above the existing functions):

```ts
import { z } from 'zod';

/**
 * Shared password policy: min 8 chars, at least one letter and one number.
 * Single source of truth for every new-password input (admin reset + self change).
 * Symbols are allowed but not required.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/__tests__/password.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/password.ts lib/__tests__/password.test.ts
git commit -m "feat(auth): shared passwordSchema (min 8, letter + number)"
```

---

## Task 3: `GET /api/v1/users` — admin user list

**Files:**
- Create: `src/app/api/v1/users/route.ts`
- Test: `src/app/api/v1/__tests__/users-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/v1/__tests__/users-list.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrganization: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

import { GET } from '../users/route';
import { prisma } from '@/lib/prisma';

const adminHeaders = { 'x-role-type': 'ADMIN', 'x-org-id': 'org-a', 'x-user-id': 'u1' };

describe('GET /api/v1/users', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns org-scoped users for an admin', async () => {
    (prisma.userOrganization.findMany as any).mockResolvedValue([
      { user: { id: 'u2', fullName: 'Staff One', email: 's1@demo.com', status: 'ACTIVE' }, role: { name: 'Accounting Staff' } },
    ]);
    const req = new NextRequest('http://localhost/api/v1/users', { headers: adminHeaders });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { id: 'u2', fullName: 'Staff One', email: 's1@demo.com', status: 'ACTIVE', roleName: 'Accounting Staff' },
    ]);
    expect((prisma.userOrganization.findMany as any).mock.calls[0][0].where.organizationId).toBe('org-a');
  });

  it('rejects a non-admin with 403', async () => {
    const req = new NextRequest('http://localhost/api/v1/users', {
      headers: { 'x-role-type': 'CUSTOM', 'x-org-id': 'org-a', 'x-user-id': 'u3' },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/v1/__tests__/users-list.test.ts`
Expected: FAIL — cannot find `../users/route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/users/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, withHandler, requireOrg } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const orgId = requireOrg(req);

  const memberships = await prisma.userOrganization.findMany({
    where: { organizationId: orgId, isActive: true },
    include: {
      user: { select: { id: true, fullName: true, email: true, status: true } },
      role: { select: { name: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const data = memberships.map((m) => ({
    id: m.user.id,
    fullName: m.user.fullName,
    email: m.user.email,
    status: m.user.status,
    roleName: m.role.name,
  }));

  return ok({ data });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/v1/__tests__/users-list.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/users/route.ts src/app/api/v1/__tests__/users-list.test.ts
git commit -m "feat(auth): GET /api/v1/users admin user list"
```

---

## Task 4: `POST /api/v1/users/[id]/reset-password` — admin reset

**Files:**
- Create: `src/app/api/v1/users/[id]/reset-password/route.ts`
- Test: `src/app/api/v1/__tests__/users-reset-password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/v1/__tests__/users-reset-password.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrganization: { findFirst: vi.fn() },
    user: { update: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return { ...actual, hashPassword: vi.fn(async (p: string) => `hashed:${p}`) };
});
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return { ...actual, logAudit: vi.fn() };
});

import { POST } from '../users/[id]/reset-password/route';
import { prisma } from '@/lib/prisma';

const adminHeaders = {
  'x-role-type': 'ADMIN', 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json',
};
const makeReq = (id: string, body: unknown, headers = adminHeaders) =>
  new NextRequest(`http://localhost/api/v1/users/${id}/reset-password`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/v1/users/[id]/reset-password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets the password and forces change on next login', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue({ id: 'm1', userId: 'u2' });
    (prisma.user.update as any).mockResolvedValue({ id: 'u2' });
    const res = await POST(makeReq('u2', { newPassword: 'newpass123' }), ctx('u2'));
    expect(res.status).toBe(200);
    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u2' });
    expect(call.data.passwordHash).toBe('hashed:newpass123');
    expect(call.data.mustChangePassword).toBe(true);
  });

  it('rejects a non-admin with 403', async () => {
    const res = await POST(
      makeReq('u2', { newPassword: 'newpass123' }, { ...adminHeaders, 'x-role-type': 'CUSTOM' }),
      ctx('u2'),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the target user is not in the caller org', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue(null);
    const res = await POST(makeReq('u9', { newPassword: 'newpass123' }), ctx('u9'));
    expect(res.status).toBe(404);
    expect(prisma.user.update as any).not.toHaveBeenCalled();
  });

  it('rejects a weak password with 400', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue({ id: 'm1', userId: 'u2' });
    const res = await POST(makeReq('u2', { newPassword: 'short' }), ctx('u2'));
    expect(res.status).toBe(400);
    expect(prisma.user.update as any).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/v1/__tests__/users-reset-password.test.ts`
Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/users/[id]/reset-password/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, withHandler, requireAuth, logAudit } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { hashPassword, passwordSchema } from '@/lib/password';

export const runtime = 'nodejs';

const bodySchema = z.object({ newPassword: passwordSchema });

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const { orgId, userId: actorId } = requireAuth(req);
  const { id: targetUserId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  // Org scoping: only reset users who belong to the caller's organization.
  const membership = await prisma.userOrganization.findFirst({
    where: { userId: targetUserId, organizationId: orgId },
    select: { id: true },
  });
  if (!membership) return err('User not found', 404);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: targetUserId },
    data: { passwordHash, mustChangePassword: true },
  });

  logAudit({
    orgId,
    actorId,
    entityType: 'User',
    entityId: targetUserId,
    action: 'RESET_PASSWORD',
    payload: { event: 'admin_reset' },
  });

  return ok({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/v1/__tests__/users-reset-password.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/users/[id]/reset-password/route.ts src/app/api/v1/__tests__/users-reset-password.test.ts
git commit -m "feat(auth): POST admin reset-password endpoint"
```

---

## Task 5: `POST /api/v1/users/me/password` — self-service change

**Files:**
- Create: `src/app/api/v1/users/me/password/route.ts`
- Test: `src/app/api/v1/__tests__/users-me-password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/v1/__tests__/users-me-password.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return {
    ...actual,
    hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
    comparePassword: vi.fn(),
  };
});
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return { ...actual, logAudit: vi.fn() };
});

import { POST } from '../users/me/password/route';
import { prisma } from '@/lib/prisma';
import { comparePassword } from '@/lib/password';

const headers = { 'x-org-id': 'org-a', 'x-user-id': 'u2', 'content-type': 'application/json' };
const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/password', {
    method: 'POST', headers, body: JSON.stringify(body),
  });

describe('POST /api/v1/users/me/password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('changes the password and clears the must-change flag', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', passwordHash: 'old-hash' });
    (comparePassword as any).mockResolvedValue(true);
    (prisma.user.update as any).mockResolvedValue({ id: 'u2' });
    const res = await POST(makeReq({ currentPassword: 'temp123ab', newPassword: 'fresh123' }));
    expect(res.status).toBe(200);
    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.data.passwordHash).toBe('hashed:fresh123');
    expect(call.data.mustChangePassword).toBe(false);
  });

  it('rejects a wrong current password with 400', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', passwordHash: 'old-hash' });
    (comparePassword as any).mockResolvedValue(false);
    const res = await POST(makeReq({ currentPassword: 'wrong123', newPassword: 'fresh123' }));
    expect(res.status).toBe(400);
    expect(prisma.user.update as any).not.toHaveBeenCalled();
  });

  it('rejects a weak new password with 400', async () => {
    const res = await POST(makeReq({ currentPassword: 'temp123ab', newPassword: 'weak' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/v1/__tests__/users-me-password.test.ts`
Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/users/me/password/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, err, withHandler, requireAuth, logAudit } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { hashPassword, comparePassword, passwordSchema } from '@/lib/password';

export const runtime = 'nodejs';

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const { orgId, userId } = requireAuth(req);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user || !user.passwordHash) return err('User not found', 404);

  const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return err('Current password is incorrect', 400);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'User',
    entityId: userId,
    action: 'CHANGE_PASSWORD',
    payload: { event: 'self_change' },
  });

  return ok({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/v1/__tests__/users-me-password.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/users/me/password/route.ts src/app/api/v1/__tests__/users-me-password.test.ts
git commit -m "feat(auth): POST self-service change-password endpoint"
```

---

## Task 6: Surface `mustChangePassword` in login + me responses

**Files:**
- Modify: `src/app/api/v1/auth/login/route.ts:74-88`
- Modify: `src/app/api/v1/auth/me/route.ts:58-73`

No new test (the `User` query already returns the scalar via `include`; covered end-to-end in Task 12). Verified by `tsc`.

- [ ] **Step 1: Add the flag to the login response**

In `src/app/api/v1/auth/login/route.ts`, in the `NextResponse.json({ ... })` object (the one with `user`, `org`, `needsInventoryValuationSetup`, `role`), add a line right after `needsInventoryValuationSetup: !organization.costingMethod,`:

```ts
      mustChangePassword: user.mustChangePassword === true,
```

- [ ] **Step 2: Add the flag to the me response**

In `src/app/api/v1/auth/me/route.ts`, in its `NextResponse.json({ ... })` object, add the same line right after `needsInventoryValuationSetup: !organization.costingMethod,`:

```ts
        mustChangePassword: user.mustChangePassword === true,
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (`user.mustChangePassword` resolves now that Task 1 added the column and regenerated the client.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/auth/login/route.ts src/app/api/v1/auth/me/route.ts
git commit -m "feat(auth): return mustChangePassword from login + me"
```

---

## Task 7: Auth store — flag state + clear action

**Files:**
- Modify: `src/stores/useAuthStore.ts`

No unit test (Zustand wiring; verified by `tsc` + Task 12 preview run).

- [ ] **Step 1: Add to the `AuthStore` interface**

In `src/stores/useAuthStore.ts`, in `interface AuthStore` (after `needsInventoryValuationSetup: boolean;`):

```ts
    mustChangePassword:  boolean;
    clearMustChangePassword: () => void;
```

- [ ] **Step 2: Add to `EMPTY_SESSION`**

In the `EMPTY_SESSION` object, add after `needsInventoryValuationSetup: false,`:

```ts
  mustChangePassword: false,
```

- [ ] **Step 3: Add to initial state + the clear action**

In `create<AuthStore>()((set, get) => ({ ... }))`, add after `needsInventoryValuationSetup: false,` (the initial-state line near the top of the store object):

```ts
  mustChangePassword: false,

  clearMustChangePassword: () => set({ mustChangePassword: false }),
```

- [ ] **Step 4: Set the flag from `checkSession` and `login`**

In BOTH the `checkSession` success `set({ ... })` block and the `login` `set({ ... })` block, add this line alongside `needsInventoryValuationSetup: ...`:

```ts
          mustChangePassword: data.mustChangePassword === true,
```

(Leave `loginWithGoogle` as-is — Google users never get an admin-typed temp password.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/stores/useAuthStore.ts
git commit -m "feat(auth): track mustChangePassword in auth store"
```

---

## Task 8: React Query hooks (`useUsers`)

**Files:**
- Create: `src/hooks/useUsers.ts`

No unit test (thin wrapper; verified by `tsc` + Task 12).

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useUsers.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';

export type LoginAccount = {
  id: string;
  fullName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  roleName: string;
};

export const USER_KEYS = {
  list: ['users', 'login-accounts'] as const,
};

export function useLoginAccounts(enabled = true) {
  return useQuery({
    queryKey: USER_KEYS.list,
    queryFn: () => api.get<{ data: LoginAccount[] }>('/api/v1/users'),
    enabled,
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      api.post(`/api/v1/users/${userId}/reset-password`, { newPassword }),
  });
}

export function useChangeOwnPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post('/api/v1/users/me/password', body),
    onSuccess: () => {
      useAuthStore.getState().clearMustChangePassword();
      qc.invalidateQueries({ queryKey: USER_KEYS.list });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUsers.ts
git commit -m "feat(auth): useUsers React Query hooks"
```

---

## Task 9: Self-service Change Password modal + header entry

**Files:**
- Create: `src/components/auth/ChangePasswordModal.tsx`
- Modify: `src/components/Layout/Layout.tsx`

- [ ] **Step 1: Create the modal component**

Create `src/components/auth/ChangePasswordModal.tsx`:

```tsx
import React, { useState } from 'react';
import Modal from '../UI/Modal';
import Input from '../UI/Input';
import Button from '../UI/Button';
import { useChangeOwnPassword } from '../../hooks/useUsers';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const changePassword = useChangeOwnPassword();

  const reset = () => {
    setCurrentPassword(''); setNewPassword(''); setConfirm(''); setError(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    setError(null);
    if (newPassword !== confirm) { setError('New password and confirmation do not match.'); return; }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change password.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Change Password" size="sm">
      <div className="p-6">
        <Input label="Current password" type="password" value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)} required />
        <Input label="New password" type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} required />
        <Input label="Confirm new password" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
        <p className="text-xs text-neutral-500 -mt-2 mb-3">
          At least 8 characters, including a letter and a number.
        </p>
        {error && <p className="text-sm text-danger-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button text="Cancel" variant="secondary" onClick={handleClose} />
          <Button text="Update Password" variant="primary" loading={changePassword.isPending}
            disabled={!currentPassword || !newPassword || !confirm} onClick={handleSubmit} />
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire it into the header**

In `src/components/Layout/Layout.tsx`: add the imports near the top (with the other imports):

```tsx
import { useState } from 'react';
import ChangePasswordModal from '../auth/ChangePasswordModal';
```

Inside the component body (near `const logout = useAuthStore((s) => s.logout);`), add:

```tsx
    const [showChangePassword, setShowChangePassword] = useState(false);
```

Then, in the JSX where the Logout button lives (currently around line 29-30), add a "Change Password" button immediately before the Logout `<Button>`, and render the modal right after it:

```tsx
                        <span className="text-sm font-medium text-neutral-800">{user?.fullName || 'User'}</span>
                        <Button text="Change Password" size="small" variant="tertiary" onClick={() => setShowChangePassword(true)} />
                        <Button text="Logout" size="small" variant="tertiary" onClick={handleLogout} />
                        <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
```

(`Layout.tsx` currently imports only `import React from 'react';` — no `useState` — so the separate `import { useState } from 'react';` line above is correct and creates no duplicate binding.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Verify in the preview**

Start the dev servers (frontend 5173 + backend 3000 per `scripts/dev-setup.sh`), log in as admin, click "Change Password", submit a too-short password → see the inline policy hint and a server "at least 8 characters" error; submit a valid new password → modal closes with no error. Re-login with the new password to confirm.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/ChangePasswordModal.tsx src/components/Layout/Layout.tsx
git commit -m "feat(auth): self-service Change Password modal in header"
```

---

## Task 10: Forced password change on next login

**Files:**
- Create: `src/components/auth/ForcedPasswordChange.tsx`
- Modify: `src/components/auth/ProtectedRoute.tsx`

- [ ] **Step 1: Create the full-screen forced component**

Create `src/components/auth/ForcedPasswordChange.tsx`:

```tsx
import React, { useState } from 'react';
import Input from '../UI/Input';
import Button from '../UI/Button';
import { useChangeOwnPassword } from '../../hooks/useUsers';
import { useAuthStore } from '../../stores/useAuthStore';

export default function ForcedPasswordChange(): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const changePassword = useChangeOwnPassword();
  const logout = useAuthStore((s) => s.logout);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword !== confirm) { setError('New password and confirmation do not match.'); return; }
    try {
      // On success the hook clears mustChangePassword, which unmounts this screen.
      await changePassword.mutateAsync({ currentPassword, newPassword });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change password.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Set a new password</h1>
        <p className="mt-2 mb-5 text-sm leading-6 text-neutral-600">
          Your password was reset by an administrator. Choose a new password to continue.
        </p>
        <Input label="Temporary password" type="password" value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)} required />
        <Input label="New password" type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} required />
        <Input label="Confirm new password" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
        <p className="text-xs text-neutral-500 -mt-2 mb-3">
          At least 8 characters, including a letter and a number.
        </p>
        {error && <p className="text-sm text-danger-600 mb-3">{error}</p>}
        <div className="flex justify-between gap-2">
          <Button text="Logout" variant="ghost" onClick={() => logout()} />
          <Button text="Set Password" variant="primary" loading={changePassword.isPending}
            disabled={!currentPassword || !newPassword || !confirm} onClick={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate it in ProtectedRoute**

In `src/components/auth/ProtectedRoute.tsx`:

Add the import near the top:
```tsx
import ForcedPasswordChange from './ForcedPasswordChange';
```

Select the flag alongside the other store selectors (after `const user = useAuthStore((s) => s.user);`):
```tsx
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
```

Then add this block immediately AFTER the `if (!user) { return <Navigate to="/login" ... /> }` block and BEFORE the `needsInventoryValuationSetup` block:
```tsx
  if (mustChangePassword) {
    return <ForcedPasswordChange />;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Verify in the preview**

With dev servers running: as admin, reset a staff user's password (via the Task 11 card, or temporarily call the endpoint). Log in as that staff user with the temp password → the blocking "Set a new password" screen appears and no nav is reachable. Set a valid new password → screen disappears and the app loads. Log out and back in with the new password → no forced screen (flag cleared).

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/ForcedPasswordChange.tsx src/components/auth/ProtectedRoute.tsx
git commit -m "feat(auth): force password change on next login"
```

---

## Task 11: Admin "Login Accounts" card in Security settings

**Files:**
- Create: `src/components/auth/ResetPasswordModal.tsx`
- Modify: `src/views/settings/SecurityRolesTab.tsx`

- [ ] **Step 1: Create the admin reset modal**

Create `src/components/auth/ResetPasswordModal.tsx`:

```tsx
import React, { useState } from 'react';
import Modal from '../UI/Modal';
import Input from '../UI/Input';
import Button from '../UI/Button';
import { useResetUserPassword, type LoginAccount } from '../../hooks/useUsers';

interface ResetPasswordModalProps {
  account: LoginAccount | null;
  onClose: () => void;
}

export default function ResetPasswordModal({ account, onClose }: ResetPasswordModalProps): React.ReactElement {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const resetPassword = useResetUserPassword();

  const handleClose = () => {
    setNewPassword(''); setConfirm(''); setError(null); setDone(false); onClose();
  };

  const handleSubmit = async () => {
    if (!account) return;
    setError(null);
    if (newPassword !== confirm) { setError('Password and confirmation do not match.'); return; }
    try {
      await resetPassword.mutateAsync({ userId: account.id, newPassword });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset password.');
    }
  };

  return (
    <Modal isOpen={account !== null} onClose={handleClose}
      title={`Reset password — ${account?.fullName ?? ''}`} size="sm">
      <div className="p-6">
        {done ? (
          <>
            <p className="text-sm text-neutral-700 mb-4">
              Temporary password set for <strong>{account?.email}</strong>. Share it with them
              securely — they will be required to choose their own password at next login.
            </p>
            <div className="flex justify-end">
              <Button text="Done" variant="primary" onClick={handleClose} />
            </div>
          </>
        ) : (
          <>
            <Input label="Temporary password" type="password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required />
            <Input label="Confirm password" type="password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required />
            <p className="text-xs text-neutral-500 -mt-2 mb-3">
              At least 8 characters, including a letter and a number.
            </p>
            {error && <p className="text-sm text-danger-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button text="Cancel" variant="secondary" onClick={handleClose} />
              <Button text="Reset Password" variant="primary" loading={resetPassword.isPending}
                disabled={!newPassword || !confirm} onClick={handleSubmit} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Add the "Login Accounts" card to SecurityRolesTab**

In `src/views/settings/SecurityRolesTab.tsx`:

Add imports near the top:
```tsx
import { useLoginAccounts, type LoginAccount } from '../../hooks/useUsers';
import { useAuthStore } from '../../stores/useAuthStore';
import ResetPasswordModal from '../../components/auth/ResetPasswordModal';
import { KeyRound } from 'lucide-react';
```

Inside the component, alongside the other hooks/state:
```tsx
    const roleType = useAuthStore((s) => s.roleType);
    const isAdmin = roleType === 'ADMIN';
    const { data: loginAccountsData } = useLoginAccounts(isAdmin);
    const [resetTarget, setResetTarget] = useState<LoginAccount | null>(null);
    const loginAccounts = loginAccountsData?.data ?? [];
```

Then render a new `<Card>` immediately BEFORE the existing `<Card title="Global Security Settings">` (admin-only). It lists real DB login accounts with a per-row Reset button:
```tsx
            {isAdmin && (
              <Card title="Login Accounts">
                <p className="settings-muted">
                  Real sign-in accounts. Resetting a password sets a temporary one and forces the
                  user to choose their own at next login. (This is separate from the role list above,
                  which configures permissions.)
                </p>
                <div className="mt-3 divide-y divide-neutral-200">
                  {loginAccounts.map((acct) => (
                    <div key={acct.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="text-sm font-medium text-neutral-800">{acct.fullName}</div>
                        <div className="text-xs text-neutral-500">{acct.email} · {acct.roleName}</div>
                      </div>
                      <Button text="Reset password" size="small" variant="secondary"
                        icon={<KeyRound size={14} />} onClick={() => setResetTarget(acct)} />
                    </div>
                  ))}
                  {loginAccounts.length === 0 && (
                    <p className="py-2.5 text-sm text-neutral-500">No login accounts found.</p>
                  )}
                </div>
              </Card>
            )}
            <ResetPasswordModal account={resetTarget} onClose={() => setResetTarget(null)} />
```

(If `useState` is not already imported in this file, add it to the React import. It is currently imported — `import React, { useState } from 'react';` — so just use it.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Verify in the preview**

As admin, open Settings → Security. The "Login Accounts" card lists the seeded real users. Click "Reset password" on a staff user, set a valid temp password → success message. (As a non-admin, the card is absent.) Then complete the forced-change verification from Task 10 Step 4.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/ResetPasswordModal.tsx src/views/settings/SecurityRolesTab.tsx
git commit -m "feat(auth): admin Login Accounts card with password reset"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: all tests pass, including the four new files (password policy + three endpoints).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: only the pre-existing unrelated `lib/backup/scheduler.ts` `node-cron` error, nothing from the files touched here.

- [ ] **Step 3: End-to-end preview run**

With both dev servers running, exercise the full path:
1. Log in as admin (`admin@demo.com` / `admin123`).
2. Settings → Security → Login Accounts → reset a staff user to `temp123ab`.
3. Log out, log in as that staff user with `temp123ab` → forced "Set a new password" screen blocks the app.
4. Set `staff456cd` → app loads.
5. Log out, log back in as staff with `staff456cd` → no forced screen.
6. Header → Change Password → change it again → re-login confirms.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(auth): verify admin password reset flow end-to-end"
```

---

## Merge checklist

- [ ] `npx prisma db push` on the merge target (adds `User.mustChangePassword`); reseed if the target DB is rebuilt (`npm run db:seed`).
- [ ] Confirm `src/middleware.ts` still injects `x-user-id`/`x-org-id`/`x-role-type` for `/api/v1/users/*` and still skips `/api/v1/auth/*`.
- [ ] Seeded logins (`admin123`, `cashier123`) satisfy the new policy, so no one is locked out at merge.

---

## Notes for the implementer

- **DRY:** `passwordSchema` is the single source of truth for password rules — never re-inline the regex/length checks in a route or component.
- **Security:** never log password values. Audit payloads carry only an `event` label.
- **Org scoping:** the reset endpoint MUST verify the target user has a `UserOrganization` row in the caller's org before updating — do not `user.update` by id alone.
- **Out of scope (do not build):** generated/random temp passwords, email reset links, full user CRUD/role assignment against real users, password history/expiry/symbol rules.
```
