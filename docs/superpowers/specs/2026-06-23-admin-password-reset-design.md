# Admin Password Reset — Design

> Created 2026-06-23 · Status: approved (design), pending implementation plan
> Context: MSM Accounting Software is internal, self-hosted on a LAN. MFA is intentionally
> NOT in scope (see ROADMAP.md discussion). The higher-priority gap is that there is no way
> to recover a forgotten password without re-seeding or editing PostgreSQL directly.

## Problem

There is currently no in-app password reset of any kind:

- No self-service "forgot password" on the login page.
- No admin "reset this user's password" action.
- The **Settings → Security → Users list is a localStorage mock** (`useAccessStore`,
  `addUser` writes to a Zustand store). It is completely disconnected from the real login
  accounts, which live in the database (`User` → `UserOrganization` → `Role`, with bcrypt
  `passwordHash`). Adding a "user" in that tab does not create a real login.

Consequently, the only way to set or reset a password today is to re-run `prisma/seed.ts`
or edit `user.passwordHash` directly in the database.

## Goal

Let an `ADMIN` reset any user's password from within the app, against **real DB users**,
with the user forced to choose their own new password on next login. Include the
self-service "change my password" path needed to make the forced flow work.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Minimal real reset: read-only real-user list + admin reset + self-service change-password. No full user CRUD. |
| Temp password | Admin **types** the temporary password. No generated/random password. |
| Password policy | Min 8 chars **and** must contain at least one letter and at least one number. Applies to every new password (admin-set temp passwords and user-chosen passwords alike). |
| After reset | **Force change on next login** (`mustChangePassword` flag). |
| Authorization | `ADMIN` role only, via the existing `x-role-type` header pattern. |

## Architecture

### Schema change

Add one field to the `User` model in `prisma/schema.prisma`:

```prisma
mustChangePassword Boolean @default(false)
```

Requires `prisma db push` at merge (consistent with prior features such as backup and
GR/IR). No other schema changes. Reuses existing `passwordHash` and `lib/password.ts`
(`hashPassword` / `comparePassword`, bcrypt cost 12).

### Password policy (shared validator)

A single source of truth, defined once and reused everywhere a new password is accepted
(both endpoints; the frontend mirrors the rule for inline feedback but the server is
authoritative). Add to `lib/password.ts`:

```ts
import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');
```

Symbols are allowed but not required. A failing password returns **400** with the specific
Zod message so the admin/user sees why (e.g. "Password must contain at least one number").

### Why endpoints live under `/api/v1/users/*`

`src/middleware.ts` verifies the JWT cookie and injects `x-user-id`, `x-org-id`, and
`x-role-type` on every `/api/v1/*` request **except** `/api/v1/auth/*`, which it skips.
Hosting the new endpoints under `/api/v1/users/*` means they automatically receive those
injected headers; hosting them under `/api/v1/auth/*` would force each to re-verify the
cookie by hand (as `login` and `me` do today). The self-service change endpoint therefore
lives at `/api/v1/users/me/password`, not `/api/v1/auth/*`.

### Endpoints

All three reuse `lib/api-utils.ts` helpers (`ok` / `err`) and `logAudit`. Admin gating
reuses the exact backup-route convention:

```ts
if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
```

#### `GET /api/v1/users` — ADMIN only
Returns real DB users in the caller's org, scoped by `x-org-id` via `UserOrganization`.
Fields: `id`, `fullName`, `email`, `status`, role `name`. No password material.

#### `POST /api/v1/users/[id]/reset-password` — ADMIN only
- Body (Zod): `{ newPassword }` validated by the shared `passwordSchema`.
- Verifies the target user belongs to the caller's org (`x-org-id`); otherwise **404** (do
  not reveal whether a user exists in another org).
- `passwordHash = await hashPassword(newPassword)`, `mustChangePassword = true`.
- Audit: `{ action: 'RESET_PASSWORD', actorId: x-user-id, entityType: 'User', entityId: targetId }`.
- **Never logs the password value.**

#### `POST /api/v1/users/me/password` — any authenticated user
- Body (Zod): `{ currentPassword: string, newPassword }` where `newPassword` uses the shared
  `passwordSchema`.
- Reads `x-user-id`. Verifies `currentPassword` against stored hash (`comparePassword`);
  wrong current → **400** (input validation failure on an already-authenticated request,
  not a session-auth failure).
- On success: `passwordHash = hashPassword(newPassword)`, `mustChangePassword = false`.
- Audit: `{ action: 'CHANGE_PASSWORD', actorId: x-user-id, entityType: 'User', entityId: self }`.
- Powers both the self-service change AND the forced-change screen. In the forced case the
  "current" password is the temp one the admin set, which the user knows — so requiring the
  current password remains correct and consistent.

### Forced-change flow

1. `auth/login` and `auth/me` responses gain a `mustChangePassword` boolean. Login still
   issues the JWT regardless, so the user can call the change endpoint.
2. `useAuthStore` stores the flag.
3. The app shell / `ProtectedRoute` checks it: when `true`, it renders a **blocking
   "Set a new password" screen** — no navigation away, Logout still available — until
   `POST /api/v1/users/me/password` succeeds and clears the flag (locally and server-side).

### Frontend UI

- **Settings → Security:** a new **"Login Accounts"** card listing real DB users
  (`GET /api/v1/users`) with a **"Reset password"** button per row → modal where the admin
  types the temporary password. This is **additive**: the existing mock Users/Roles cards
  are left untouched (per minimal-scope decision), with a one-line note clarifying that the
  new card is what manages real login passwords. Accepted tradeoff: two user-ish lists
  coexist in the same tab for now.
- **Self-service "Change Password":** a small modal launched from the header user menu
  (next to Logout). The forced-change screen reuses the same form component.

## Testing

Follows existing patterns in `src/app/api/v1/__tests__` and `lib/__tests__`.

- Admin reset updates the hash (new password verifies) and sets `mustChangePassword = true`.
- Non-admin caller → 403.
- Cross-org target user → not resettable (404).
- Self change-password: wrong current password → rejected; correct → hash updated and flag
  cleared.
- Password policy: a `newPassword` that is too short, letters-only, or numbers-only → 400
  with the matching message, on both the reset and the change endpoints.
- `login` / `me` return `mustChangePassword` correctly.

## Out of scope (deliberate)

- Self-service "forgot password" / email reset links (moot on a LAN; no guaranteed SMTP).
- Generated/random temporary passwords.
- Full user CRUD and role assignment against real DB users (i.e. replacing the localStorage
  mock Users tab). Flagged as future work to unify the mock RBAC list with real accounts.
- Password complexity beyond "min 8, at least one letter and one number" — e.g. mandatory
  symbols, dictionary/breach checks, or password history/expiry.

## Merge checklist

- [ ] `prisma db push` (adds `User.mustChangePassword`).
- [ ] Verify middleware still skips `/api/v1/auth/*` and injects headers for `/api/v1/users/*`.
