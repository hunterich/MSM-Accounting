# Security & Roles → /users page + DB-backed RBAC (PR B)

**Date:** 2026-06-26
**Branch base:** `claude/settings-persistence` (PR A / #71) — stacks; retarget to `main` once PR A merges.
**Status:** Design — awaiting review

## Context

The RBAC backend is **half-built**. The DB models (`Role`, `RolePermission`, `UserOrganization`) and *server-side enforcement* (`requirePermission`/`withPermission` reading `RolePermission` rows) already exist and are live. The `/auth/me` endpoint returns the current user's DB permissions. But:

- There is **no write API** for roles. `SecurityRolesTab.tsx` edits a client-side localStorage mock (`useAccessStore`) that never reaches the database.
- The access-scheduling fields the UI exposes (`Role.allowedDays`/`startTime`/`endTime`) have DB columns but the UI never persists them and nothing enforces them.
- User→role assignment (`UserOrganization.roleId`) is read-only (listed via `GET /api/v1/users`) with no mutation endpoint.
- There is no user-creation endpoint (only list + `[id]/reset-password` + `me/password`).

**Key property: no schema change is needed.** Every model, column, and enum required already exists (`Role`, `RolePermission` with `canView/Create/Edit/Delete/Approve`, `UserOrganization`, `ModuleKey`, `RoleType`, `InvoiceAccessScope`, `Role.allowedDays/startTime/endTime`, `User.mustChangePassword`). PR B is purely new API endpoints + hooks + a UI rewire + a page move.

## Goal

Make the Security & Roles UI operate on the **database** (real roles, permissions, user-role assignments, and user creation), and move it to its own **`/users` "Users & Roles"** page under Operations.

## Decisions (resolved during brainstorming)

- **Page:** new top-level route **`/users`** ("Users & Roles") in the Operations sidebar group (mirrors the `/tools` move). Gated by the existing `settings` permission.
- **Scope:** roles CRUD + permission matrix + user→role assignment **+ user create/invite** (email + temp password, `mustChangePassword`). Access scheduling = **persist only, no enforcement** (a later effort).
- **No migration.**

## Scope

### In scope
- Roles CRUD API + user-role assignment + user creation API.
- `useRoles` hooks; rewire `SecurityRolesTab` off `useAccessStore` onto the API.
- Move the tab to a new `/users` page; remove the `security` tab from Settings.
- Persist access scheduling (day/time window) via the role update (not enforced).

### Out of scope
- Server-side **enforcement** of access scheduling (persist only).
- Changing the permission model / `ModuleKey` set.
- Self-service signup / email delivery of invites (temp password is shown to the admin to convey out-of-band, same as the existing reset-password flow).
- The `useAccessStore` "extra actions" (reprint/overridePrice) used by `useModulePermissions.useExtraAction` — leave the mock for those; only the core role/permission matrix moves to the DB. (Flag as a follow-up.)

## Architecture

### Backend — new route handlers (all `withPermission({ module: 'SETTINGS', action })`, matching the existing users routes)

`src/app/api/v1/roles/route.ts`
- **GET** (`action: 'view'`) — list org roles with their `permissions[]`, schedule fields, `roleType`, `isActive`, and member count (`_count.memberships`).
- **POST** (`action: 'create'`) — create a role + its `RolePermission` rows in a transaction. Validate name non-empty + unique per org (DB `@@unique([organizationId, name])` → map P2002 to 409).

`src/app/api/v1/roles/[id]/route.ts`
- **PUT** (`action: 'edit'`) — update role meta (`name`, `isActive`, `invoiceAccessScope`, `allowedDays`, `startTime`, `endTime`) and **upsert** the permission matrix (`upsert` per `(roleId, moduleKey)`). Guard: cannot deactivate/strip the last role with admin-equivalent access (lockout prevention — see Safety).
- **DELETE** (`action: 'delete'`) — block (409) if any active `UserOrganization` references the role; block deleting a `roleType: ADMIN` system role.

`src/app/api/v1/users/[id]/role/route.ts`
- **PUT** (`action: 'edit'`) — reassign a user's `UserOrganization.roleId` for the org. Guard: an actor cannot change their own role to a non-admin one (self-lockout); cannot remove the last admin.

`src/app/api/v1/users/route.ts` — add **POST** (`action: 'create'`) to the existing file
- Create a `User` (email unique) + `UserOrganization` (with chosen `roleId`, `isActive: true`); set a generated temp password via `hashPassword` and `mustChangePassword: true`. Reuse `@/lib/password` (`hashPassword`, and `passwordSchema` to validate a supplied password, or generate a compliant one). Return the temp password once in the response for the admin to convey (mirrors `reset-password`). Map duplicate email to 409.

Each endpoint: zod input schema in `types/api.ts`, `logAudit(...)` on writes, `corsPreflightResponse()` OPTIONS, `requireOrg(req)` scoping.

### Safety guards (correctness-critical)
- **No lockout:** the org must always retain ≥1 active user whose role grants `SETTINGS` edit (admin-equivalent). Reject role edits / deletes / reassignments / deactivations that would violate this.
- **No self-demotion lockout:** an actor cannot strip their own `SETTINGS` access in a single call.
- **System roles:** `roleType: ADMIN` roles cannot be deleted; their core admin permissions cannot be revoked.

### Frontend
- `src/hooks/useRoles.ts` — `useRoles`, `useCreateRole`, `useUpdateRole`, `useDeleteRole`, `useAssignUserRole`, `useCreateUser` (React Query; invalidate roles/users + `/auth/me` so the actor's own permissions refresh).
- `src/views/users/UsersAndRoles.tsx` — the relocated Security & Roles UI, rewired:
  - Roles list + permission matrix ← `useRoles` (DB), edits → `useUpdateRole`.
  - Create/delete role → `useCreateRole`/`useDeleteRole`.
  - Users list ← existing `useLoginAccounts`; change role → `useAssignUserRole`; create user → `useCreateUser` (show the returned temp password once).
  - Access schedule (days + start/end) → persisted via `useUpdateRole` (clearly labeled "not enforced yet").
  - `SecurityRolesTab.tsx` is refactored into this page (or imported by it); the in-`useAccessStore` mutations are replaced with the hooks.
- `src/App.tsx` — lazy route `/users` → `UsersAndRoles`, `withPermission(..., 'settings')`.
- `src/components/Layout/Sidebar.tsx` — "Users & Roles" item in the Operations group; `useAccessStore` SUBITEM_PERMISSION_MAP `/users → settings`.
- `src/views/settings/Settings.tsx` — remove the `security` menu item + its content block. The "Users & security" group then holds only Notifications → rename that group to **"Notifications"** (or fold Notifications into Organization). Chosen: rename to "Notifications".

## Data flow
- **Load `/users`:** `GET /roles` + `GET /users` → render roles, matrix, members.
- **Edit role / assign / create:** mutate → server validates + guards + persists → invalidate `roles`, `users`, and `auth/me` (so the editing admin's own enforcement updates immediately).
- Enforcement is unchanged: it already reads `RolePermission` per request; now those rows are actually editable.

## Error handling
- Guard violations → 4xx with a clear message surfaced via `window.alert`/toast (match existing tabs).
- Duplicate name/email → 409 with a friendly message.
- All mutations wrapped; local state not advanced on failure.

## Testing
- **Integration (`test:int`, real Postgres):** create role + permissions → appears in GET; update matrix persists; delete-in-use → 409; assign user a new role updates `UserOrganization`; create user → User + membership + `mustChangePassword`; **lockout guard** rejects removing the last admin.
- **Unit:** zod validators + any permission-diff/guard helper (pure).
- **Manual:** create a role, grant it (say) AR view-only, create a user with that role, log in as them, confirm the sidebar/permissions reflect the DB role; confirm an admin cannot lock themselves out.
- `tsc`, `vite build`, full unit suite stay green.

## Rollout
- **No migration.** Pure code. Safe to deploy independently.
- The localStorage `useAccessStore` remains only for the "extra actions" follow-up; core roles now come from the DB.
