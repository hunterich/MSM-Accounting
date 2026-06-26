# Security & Roles → /users page + DB-backed RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Security & Roles UI operate on the database (roles CRUD, permission matrix, user→role assignment, user creation) and move it to a new `/users` "Users & Roles" page under Operations.

**Architecture:** The RBAC models + server enforcement already exist; this adds the missing **write API** (roles + user-role + user-create), `useRoles` hooks, and rewires the UI off the `useAccessStore` localStorage mock. No schema change.

**Tech Stack:** Next.js route handlers, Prisma (Postgres), Zod, bcryptjs (`@/lib/password`), React + React Query + Zustand, Vitest (unit + `test:int`).

**Spec:** `docs/superpowers/specs/2026-06-26-security-roles-rbac-design.md`

**Shared helper signatures (already in the repo):**
- `@/lib/api-utils`: `ok(data, status?)`, `err(message, status)`, `requireOrg(req): string`, `requireAuth(req): {orgId,userId}`, `logAudit({orgId, actorId, entityType, entityId, action, payload})`.
- `@/lib/authz`: `withPermission({ module: ModuleKey, action: Action }, handler)`, `authActor(req): {orgId,userId,roleType}` (roleType `'ADMIN'` bypasses checks). `Action = 'view'|'create'|'edit'|'delete'|'approve'`.
- `@/lib/password`: `passwordSchema` (zod), `hashPassword(plain)`.
- `@/lib/cors`: `corsPreflightResponse()`.
- Prisma models: `Role{id,organizationId,name,roleType,invoiceAccessScope,isActive,allowedDays(Json),startTime,endTime}`, `RolePermission{roleId,moduleKey(ModuleKey),canView,canCreate,canEdit,canDelete,canApprove}` `@@unique([roleId,moduleKey])`, `UserOrganization{userId,organizationId,roleId,isActive}` `@@unique([userId,organizationId])`, `User{id,email,fullName,status,passwordHash,mustChangePassword}`. Enums: `ModuleKey`, `RoleType(ADMIN|ACCOUNTANT|VIEWER|CUSTOM)`, `InvoiceAccessScope(ALL|OWN)`.

---

### Task 1: RBAC helpers (matrix shaping + admin-capability) — TDD

**Files:**
- Create: `lib/rbac/role-permissions.ts`
- Test: `lib/rbac/__tests__/role-permissions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { normalizePermissionMatrix, roleGrantsSettingsEdit, MODULE_KEYS } from '../role-permissions';

describe('normalizePermissionMatrix', () => {
  it('keeps only known module keys and coerces booleans', () => {
    const out = normalizePermissionMatrix([
      { moduleKey: 'AR_INVOICES', canView: true },
      { moduleKey: 'BOGUS', canView: true },
    ] as never);
    const ar = out.find((r) => r.moduleKey === 'AR_INVOICES');
    expect(ar).toEqual({ moduleKey: 'AR_INVOICES', canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false });
    expect(out.some((r) => r.moduleKey === 'BOGUS')).toBe(false);
  });
});

describe('roleGrantsSettingsEdit', () => {
  it('true for ADMIN roleType regardless of rows', () => {
    expect(roleGrantsSettingsEdit('ADMIN', [])).toBe(true);
  });
  it('true when a SETTINGS row has canEdit', () => {
    expect(roleGrantsSettingsEdit('CUSTOM', [{ moduleKey: 'SETTINGS', canEdit: true } as never])).toBe(true);
  });
  it('false otherwise', () => {
    expect(roleGrantsSettingsEdit('CUSTOM', [{ moduleKey: 'AR_INVOICES', canEdit: true } as never])).toBe(false);
  });
});

it('MODULE_KEYS is non-empty and includes SETTINGS', () => {
  expect(MODULE_KEYS).toContain('SETTINGS');
});
```

- [ ] **Step 2: Run — expect failure** — `npm test -- role-permissions` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { ModuleKey } from '@prisma/client';

export const MODULE_KEYS = Object.values(ModuleKey) as ModuleKey[];

export interface PermissionRowInput {
  moduleKey: ModuleKey;
  canView?: boolean; canCreate?: boolean; canEdit?: boolean; canDelete?: boolean; canApprove?: boolean;
}
export interface PermissionRow {
  moduleKey: ModuleKey;
  canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canApprove: boolean;
}

const known = new Set<string>(MODULE_KEYS);

/** Keep only known module keys, dedupe, coerce all flags to booleans. */
export function normalizePermissionMatrix(rows: PermissionRowInput[] | undefined): PermissionRow[] {
  if (!Array.isArray(rows)) return [];
  const byKey = new Map<ModuleKey, PermissionRow>();
  for (const r of rows) {
    if (!r || !known.has(r.moduleKey)) continue;
    byKey.set(r.moduleKey, {
      moduleKey: r.moduleKey,
      canView: !!r.canView, canCreate: !!r.canCreate, canEdit: !!r.canEdit,
      canDelete: !!r.canDelete, canApprove: !!r.canApprove,
    });
  }
  return [...byKey.values()];
}

/** A role can administer settings if it's the ADMIN type or has SETTINGS.canEdit. */
export function roleGrantsSettingsEdit(
  roleType: string,
  rows: Array<{ moduleKey: ModuleKey; canEdit?: boolean }>,
): boolean {
  if (roleType === 'ADMIN') return true;
  return rows.some((r) => r.moduleKey === 'SETTINGS' && !!r.canEdit);
}
```

- [ ] **Step 4: Run — expect pass** — `npm test -- role-permissions` → PASS.
- [ ] **Step 5: Commit** — `git add lib/rbac && git commit -m "feat(rbac): permission-matrix + admin-capability helpers"`

---

### Task 2: Roles list + create API

**Files:**
- Create: `src/app/api/v1/roles/route.ts`
- Modify: `types/api.ts` (add `createRoleInputSchema`)

- [ ] **Step 1: Add zod schema to `types/api.ts`**

```ts
export const permissionRowSchema = z.object({
  moduleKey: z.string().min(1),
  canView: z.boolean().optional(),
  canCreate: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canApprove: z.boolean().optional(),
});
export const createRoleInputSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required').max(60),
  roleType: z.enum(['ADMIN', 'ACCOUNTANT', 'VIEWER', 'CUSTOM']).optional(),
  invoiceAccessScope: z.enum(['ALL', 'OWN']).optional(),
  isActive: z.boolean().optional(),
  allowedDays: z.array(z.string()).nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  permissions: z.array(permissionRowSchema).optional(),
});
export const updateRoleInputSchema = createRoleInputSchema.partial();
export const assignUserRoleInputSchema = z.object({ roleId: z.string().min(1) });
export const createUserInputSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  roleId: z.string().min(1),
  password: passwordSchema.optional(), // if omitted, server generates a temp one
});
```
(Import `passwordSchema` from `@/lib/password` at the top of `types/api.ts` if not present.)

- [ ] **Step 2: Implement `src/app/api/v1/roles/route.ts`**

Mirror the style of `src/app/api/v1/users/route.ts` / `organization/settings/route.ts` (OPTIONS, `withPermission`, `requireOrg`, `ok`/`err`, `logAudit`).

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireOrg, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { createRoleInputSchema } from '@/types/api';
import { normalizePermissionMatrix } from '@/lib/rbac/role-permissions';
import type { ModuleKey, RoleType, InvoiceAccessScope } from '@prisma/client';

export const runtime = 'nodejs';
export function OPTIONS() { return corsPreflightResponse(); }

export const GET = withPermission({ module: 'SETTINGS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId },
    include: { permissions: true, _count: { select: { memberships: { where: { isActive: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ data: roles.map((r) => ({
    id: r.id, name: r.name, roleType: r.roleType, invoiceAccessScope: r.invoiceAccessScope,
    isActive: r.isActive, allowedDays: r.allowedDays, startTime: r.startTime, endTime: r.endTime,
    memberCount: r._count.memberships,
    permissions: r.permissions.map((p) => ({
      moduleKey: p.moduleKey, canView: p.canView, canCreate: p.canCreate,
      canEdit: p.canEdit, canDelete: p.canDelete, canApprove: p.canApprove,
    })),
  })) });
});

export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const { orgId, userId } = requireAuth(req);
  const parsed = createRoleInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid role payload', 400);
  const d = parsed.data;
  const matrix = normalizePermissionMatrix(d.permissions as never);

  try {
    const role = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: d.name,
        roleType: (d.roleType ?? 'CUSTOM') as RoleType,
        invoiceAccessScope: (d.invoiceAccessScope ?? 'ALL') as InvoiceAccessScope,
        isActive: d.isActive ?? true,
        allowedDays: d.allowedDays ?? undefined,
        startTime: d.startTime ?? null,
        endTime: d.endTime ?? null,
        permissions: { create: matrix.map((m) => ({ ...m, moduleKey: m.moduleKey as ModuleKey })) },
      },
      include: { permissions: true },
    });
    logAudit({ orgId, actorId: userId, entityType: 'Role', entityId: role.id, action: 'CREATE', payload: { name: role.name } });
    return ok(role, 201);
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
      return err('A role with that name already exists', 409);
    }
    throw e;
  }
});
```

- [ ] **Step 3: Typecheck** — `npm run prisma:generate && npx tsc --noEmit` → exit 0.
- [ ] **Step 4: Commit** — `git add types/api.ts src/app/api/v1/roles/route.ts && git commit -m "feat(rbac): roles list + create API"`

---

### Task 3: Role update + delete API (with guards)

**Files:**
- Create: `src/app/api/v1/roles/[id]/route.ts`

- [ ] **Step 1: Implement** (PUT upserts the matrix; DELETE guards in-use + system roles)

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { updateRoleInputSchema } from '@/types/api';
import { normalizePermissionMatrix, roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';
import type { ModuleKey } from '@prisma/client';

export const runtime = 'nodejs';
export function OPTIONS() { return corsPreflightResponse(); }

// Would this org still have an active member whose role can administer settings,
// if `changedRole` ends up with the given (roleType, matrix)? Used to prevent lockout.
async function orgRetainsAdmin(orgId: string, changedRoleId: string, nextRoleType: string, nextRows: Array<{ moduleKey: ModuleKey; canEdit?: boolean }>): Promise<boolean> {
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId, isActive: true, memberships: { some: { isActive: true } } },
    include: { permissions: { where: { moduleKey: 'SETTINGS' }, select: { moduleKey: true, canEdit: true } } },
  });
  return roles.some((r) =>
    r.id === changedRoleId
      ? roleGrantsSettingsEdit(nextRoleType, nextRows)
      : roleGrantsSettingsEdit(r.roleType, r.permissions),
  );
}

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = requireAuth(req);
  const { id } = await ctx.params;
  const existing = await prisma.role.findFirst({ where: { id, organizationId: orgId }, include: { permissions: true } });
  if (!existing) return err('Role not found', 404);

  const parsed = updateRoleInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid role payload', 400);
  const d = parsed.data;

  const nextType = d.roleType ?? existing.roleType;
  const nextRows = d.permissions !== undefined
    ? normalizePermissionMatrix(d.permissions as never)
    : existing.permissions.map((p) => ({ moduleKey: p.moduleKey, canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete, canApprove: p.canApprove }));
  const nextActive = d.isActive ?? existing.isActive;

  // Lockout guard: if this change could strip the org's last admin-capable role, reject.
  if (!nextActive || !roleGrantsSettingsEdit(nextType, nextRows)) {
    const ok2 = await orgRetainsAdmin(orgId, id, nextActive ? nextType : 'NONE', nextActive ? nextRows : []);
    if (!ok2) return err('This change would leave the organization with no administrator', 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: {
        name: d.name ?? undefined,
        roleType: d.roleType ?? undefined,
        invoiceAccessScope: d.invoiceAccessScope ?? undefined,
        isActive: d.isActive ?? undefined,
        allowedDays: d.allowedDays === undefined ? undefined : (d.allowedDays ?? undefined),
        startTime: d.startTime === undefined ? undefined : d.startTime,
        endTime: d.endTime === undefined ? undefined : d.endTime,
      },
    });
    if (d.permissions !== undefined) {
      for (const m of nextRows) {
        await tx.rolePermission.upsert({
          where: { roleId_moduleKey: { roleId: id, moduleKey: m.moduleKey as ModuleKey } },
          create: { roleId: id, ...m, moduleKey: m.moduleKey as ModuleKey },
          update: { canView: m.canView, canCreate: m.canCreate, canEdit: m.canEdit, canDelete: m.canDelete, canApprove: m.canApprove },
        });
      }
    }
  });
  logAudit({ orgId, actorId: userId, entityType: 'Role', entityId: id, action: 'UPDATE', payload: { name: d.name } });
  const updated = await prisma.role.findUnique({ where: { id }, include: { permissions: true } });
  return ok(updated);
});

export const DELETE = withPermission({ module: 'SETTINGS', action: 'delete' }, async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = requireAuth(req);
  const { id } = await ctx.params;
  const role = await prisma.role.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { memberships: { where: { isActive: true } } } } } });
  if (!role) return err('Role not found', 404);
  if (role.roleType === 'ADMIN') return err('The Admin role cannot be deleted', 409);
  if (role._count.memberships > 0) return err('Reassign users off this role before deleting it', 409);
  await prisma.role.delete({ where: { id } });
  logAudit({ orgId, actorId: userId, entityType: 'Role', entityId: id, action: 'DELETE', payload: { name: role.name } });
  return ok({ id });
});
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0. (If route ctx param typing differs from this Next version, match the signature used by another `[id]` route, e.g. `users/[id]/reset-password/route.ts`.)
- [ ] **Step 3: Commit** — `git add src/app/api/v1/roles && git commit -m "feat(rbac): role update + delete API with lockout guard"`

---

### Task 4: Reassign a user's role API

**Files:**
- Create: `src/app/api/v1/users/[id]/role/route.ts`

- [ ] **Step 1: Implement** (guards: target membership exists; no self-lockout; org retains an admin)

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, requireAuth, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { assignUserRoleInputSchema } from '@/types/api';
import { roleGrantsSettingsEdit } from '@/lib/rbac/role-permissions';

export const runtime = 'nodejs';
export function OPTIONS() { return corsPreflightResponse(); }

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId, userId: actorId } = requireAuth(req);
  const { id: targetUserId } = await ctx.params;
  const parsed = assignUserRoleInputSchema.safeParse(await req.json());
  if (!parsed.success) return err('Invalid payload', 400);

  const membership = await prisma.userOrganization.findUnique({ where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } } });
  if (!membership) return err('User is not a member of this organization', 404);
  const newRole = await prisma.role.findFirst({ where: { id: parsed.data.roleId, organizationId: orgId }, include: { permissions: { where: { moduleKey: 'SETTINGS' }, select: { moduleKey: true, canEdit: true } } } });
  if (!newRole) return err('Role not found', 404);

  // Lockout guard: if reassigning would drop the last admin-capable member, reject.
  if (!roleGrantsSettingsEdit(newRole.roleType, newRole.permissions)) {
    const otherAdmins = await prisma.userOrganization.count({
      where: {
        organizationId: orgId, isActive: true, userId: { not: targetUserId },
        role: { OR: [{ roleType: 'ADMIN' }, { permissions: { some: { moduleKey: 'SETTINGS', canEdit: true } } }] },
      },
    });
    if (otherAdmins === 0) return err('This would leave the organization with no administrator', 409);
  }

  await prisma.userOrganization.update({ where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } }, data: { roleId: parsed.data.roleId } });
  logAudit({ orgId, actorId, entityType: 'UserOrganization', entityId: membership.id, action: 'UPDATE', payload: { targetUserId, roleId: parsed.data.roleId } });
  return ok({ userId: targetUserId, roleId: parsed.data.roleId });
});
```

- [ ] **Step 2: Typecheck** → 0. **Commit** — `git add src/app/api/v1/users && git commit -m "feat(rbac): reassign user role API with lockout guard"`

---

### Task 5: Create-user API (POST on existing users route)

**Files:**
- Modify: `src/app/api/v1/users/route.ts` (add POST; keep existing GET)

- [ ] **Step 1: Add imports + POST**

Add to imports: `err, requireAuth, logAudit` from `@/lib/api-utils`; `createUserInputSchema` from `@/types/api`; `hashPassword` from `@/lib/password`.

```ts
export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(req: NextRequest) {
  const { orgId, userId: actorId } = requireAuth(req);
  const parsed = createUserInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid user payload', 400);
  const d = parsed.data;

  const role = await prisma.role.findFirst({ where: { id: d.roleId, organizationId: orgId }, select: { id: true } });
  if (!role) return err('Role not found', 404);

  const existing = await prisma.user.findUnique({ where: { email: d.email.toLowerCase() }, select: { id: true } });
  if (existing) return err('A user with that email already exists', 409);

  // Generate a compliant temp password (8+ chars, letter+digit) when none supplied.
  const tempPassword = d.password ?? `Msm-${Math.abs(hashSeed(d.email))}a1`;
  const passwordHash = await hashPassword(tempPassword);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: d.email.toLowerCase(), fullName: d.fullName, passwordHash, mustChangePassword: true, status: 'ACTIVE' } });
    await tx.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: d.roleId, isActive: true } });
    return user;
  });
  logAudit({ orgId, actorId, entityType: 'User', entityId: created.id, action: 'CREATE', payload: { email: created.email } });
  // Return the temp password ONCE so the admin can convey it (same as reset-password).
  return ok({ id: created.id, email: created.email, fullName: created.fullName, temporaryPassword: d.password ? undefined : tempPassword }, 201);
});

// Deterministic, non-cryptographic seed for a readable temp password; user must change on first login.
function hashSeed(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
```

NOTE for implementer: confirm `User.status` accepts `'ACTIVE'` (check the `UserStatus` enum in `schema.prisma`); if the enum differs, use the correct active value. Confirm `User.email` is stored lower-case elsewhere; match existing convention.

- [ ] **Step 2: Typecheck** → 0. **Commit** — `git add src/app/api/v1/users/route.ts && git commit -m "feat(rbac): create-user API (temp password + mustChangePassword)"`

---

### Task 6: Integration tests (real Postgres)

**Files:**
- Create: `lib/__tests__/integration/rbac-roles.int.test.ts`

- [ ] **Step 1: Write tests** using the harness (`createTestOrg`, `prisma`, `cleanupOrg`, `disconnect` from `./harness`). Cover, by calling Prisma directly to set up + asserting the guard logic via the helper, AND by importing the route handlers if feasible:
  - create a role with a permission matrix → reads back with the rows;
  - `roleGrantsSettingsEdit` interplay: a CUSTOM role with `SETTINGS.canEdit` counts as admin-capable;
  - delete-in-use is blocked (membership referencing the role);
  - reassigning the only admin-capable user to a non-admin role is blocked.

Keep assertions concrete. If invoking route handlers directly is awkward (they read headers), test the **guard helper + Prisma state transitions** directly (create roles/memberships, run the same count query the route uses, assert it returns 0 when it should block). Do NOT weaken assertions.

- [ ] **Step 2: Run** — `npm run test:int -- rbac-roles` (run `npm run test:int:setup` first if the test DB needs the schema). PASS.
- [ ] **Step 3: Commit** — `git add lib/__tests__/integration/rbac-roles.int.test.ts && git commit -m "test(int): RBAC roles + lockout guard"`

---

### Task 7: Frontend hooks

**Files:**
- Create: `src/hooks/useRoles.ts`

- [ ] **Step 1: Implement** (React Query; mirror `src/hooks/useUsers.ts` + `useOrganizationSettings.ts` style — `api.get/post/put/delete` from `../api/apiClient`, invalidate on success).

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export const ROLES_KEY = ['roles'] as const;

export interface ApiPermissionRow { moduleKey: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canApprove: boolean; }
export interface ApiRole { id: string; name: string; roleType: string; invoiceAccessScope: string; isActive: boolean; allowedDays: unknown; startTime: string | null; endTime: string | null; memberCount: number; permissions: ApiPermissionRow[]; }

export function useRoles() {
  return useQuery({ queryKey: ROLES_KEY, queryFn: () => api.get<{ data: ApiRole[] }>('/api/v1/roles'), select: (r) => r.data, staleTime: 30_000 });
}
function useInvalidateRbac() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ROLES_KEY }); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['auth', 'me'] }); };
}
export function useCreateRole() { const inv = useInvalidateRbac(); return useMutation({ mutationFn: (body: Partial<ApiRole>) => api.post('/api/v1/roles', body), onSuccess: inv }); }
export function useUpdateRole() { const inv = useInvalidateRbac(); return useMutation({ mutationFn: ({ id, ...body }: { id: string } & Partial<ApiRole>) => api.put(`/api/v1/roles/${id}`, body), onSuccess: inv }); }
export function useDeleteRole() { const inv = useInvalidateRbac(); return useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/roles/${id}`), onSuccess: inv }); }
export function useAssignUserRole() { const inv = useInvalidateRbac(); return useMutation({ mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) => api.put(`/api/v1/users/${userId}/role`, { roleId }), onSuccess: inv }); }
export function useCreateUser() { const inv = useInvalidateRbac(); return useMutation({ mutationFn: (body: { fullName: string; email: string; roleId: string; password?: string }) => api.post<{ id: string; temporaryPassword?: string }>('/api/v1/users', body), onSuccess: inv }); }
```
NOTE: confirm the actual query key used by `useAuthStore`/`/auth/me` and the users list (`useUsers.ts`) and match them in the invalidation (adjust `['auth','me']` / `['users']` to the real keys).

- [ ] **Step 2: Typecheck** → 0. **Commit** — `git add src/hooks/useRoles.ts && git commit -m "feat(rbac): useRoles hooks"`

---

### Task 8: Users & Roles page (rewire off the mock)

**Files:**
- Create: `src/views/users/UsersAndRoles.tsx`
- Modify: `src/views/settings/SecurityRolesTab.tsx` (or fold its JSX into the new page)

- [ ] **Step 1:** Read `SecurityRolesTab.tsx` fully. Build `UsersAndRoles.tsx` that renders the same UI (roles list, permission matrix, users list, create-role, create-user, access schedule) but sources data from `useRoles()` + `useLoginAccounts()` and performs mutations via the Task-7 hooks instead of `useAccessStore`. Replace each `useAccessStore` mutation with the API hook per this mapping:

| Old (useAccessStore) | New |
|---|---|
| `addRole(...)` | `useCreateRole().mutateAsync(...)` |
| `updateRole(id, ...)` (name/active/matrix/schedule) | `useUpdateRole().mutateAsync({ id, ... })` |
| `deleteRole(id)` | `useDeleteRole().mutateAsync(id)` |
| `addUser(...)` (assign existing) | `useAssignUserRole().mutateAsync({ userId, roleId })` |
| `addUser(...)` (new account) | `useCreateUser().mutateAsync({...})` → show returned `temporaryPassword` once in a dialog/inline notice |
| roles/users read from store | `useRoles()` / `useLoginAccounts()` |

Keep the permission matrix shape mapping: the API uses `moduleKey` (UPPER_SNAKE `ModuleKey`) + `canView/Create/Edit/Delete/Approve`; map the UI's module rows to these. Label the access-schedule controls "Saved but not enforced yet." Wrap every mutation in try/catch and surface `err.message` via `window.alert`.

If `SecurityRolesTab.tsx` is no longer used anywhere after this, delete it; otherwise leave it. Confirm with grep.

- [ ] **Step 2: Typecheck + build** — `npx tsc --noEmit && npm run build` → 0.
- [ ] **Step 3: Commit** — `git add src/views/users src/views/settings/SecurityRolesTab.tsx && git commit -m "feat(rbac): Users & Roles page wired to the DB API"`

---

### Task 9: Route, nav, and Settings cleanup

**Files:**
- Modify: `src/App.tsx`, `src/components/Layout/Sidebar.tsx`, `src/stores/useAccessStore.ts`, `src/views/settings/Settings.tsx`

- [ ] **Step 1: Route** — in `App.tsx`, add `const UsersAndRoles = lazy(() => import('./views/users/UsersAndRoles'))` and `<Route path="users" element={withPermission(<UsersAndRoles />, 'settings')} />`.
- [ ] **Step 2: Sidebar** — in the Operations group add `{ label: 'Users & Roles', path: '/users', icon: Users }` (import `Users` is already used; reuse). Place it before "Data & Tools".
- [ ] **Step 3: RBAC map** — in `useAccessStore.ts` `SUBITEM_PERMISSION_MAP` add `'/users': 'settings'`.
- [ ] **Step 4: Settings cleanup** — in `Settings.tsx`: remove the `{ id: 'security', label: 'Security & Roles', icon: Shield }` menu item and its `activeTab === 'security'` content block (the `<SecurityRolesTab .../>` render) and the now-unused `SecurityRolesTab` import + related `securitySettings` state if it becomes dead. The "Users & security" group now holds only Notifications → rename that group label to `'Notifications'`. Remove the `'security'` branch from `saveSection` if present.
- [ ] **Step 5: Typecheck + build** — `npx tsc --noEmit && npm run build` → 0. Confirm no dead references to the removed security tab.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(rbac): /users route + nav; remove Security tab from Settings"`

---

### Task 10: Full verification

- [ ] **Step 1:** `npm run prisma:generate && npx tsc --noEmit && npm test && npm run build` → all green. Run `npm run test:int -- rbac-roles` (with the test DB env) → green.
- [ ] **Step 2: Manual preview** (worktree backend on :3000, frontend on :5173, login `admin@demo.com`/`admin123`):
  - `/users` renders; roles list loads from the DB.
  - Create a role "Test Viewer" with AR Invoices view-only; it appears.
  - Create a user with that role → temp password shown once.
  - Reassign a user's role; confirm `GET /api/v1/users` reflects it.
  - Attempt to delete a role that has members → blocked (409 message).
  - Attempt to demote the only admin → blocked.
  - Confirm Settings no longer shows a Security & Roles tab; the sidebar shows "Users & Roles" under Operations.
- [ ] **Step 3:** Confirm no console errors; each mutation issues the expected `POST/PUT/DELETE` returning 2xx.

---

## Notes for the implementer
- No schema change; but run `npm run prisma:generate` before typecheck (shared cross-worktree client).
- Match the exact Next route-handler `ctx.params` typing used by the existing `[id]` routes in this repo (e.g. `users/[id]/reset-password`) — adapt the snippets if that repo uses sync params.
- Verify enum/string literals against `schema.prisma` (`UserStatus`, `RoleType`, `InvoiceAccessScope`, `ModuleKey`) before relying on them.
- Confirm the real React Query keys for the users list and `/auth/me` and use them in `useRoles` invalidation so the editing admin's own permissions refresh after a change.
- The `useAccessStore` "extra actions" (reprint/override) stay on the mock — out of scope.
