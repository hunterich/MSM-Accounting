import type { NextRequest, NextResponse } from 'next/server';
import type { ModuleKey, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { withHandler } from '@/lib/api-utils';

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve';

type Db = Prisma.TransactionClient | typeof prisma;

const COLUMN: Record<Action, 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canApprove'> = {
  view: 'canView',
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete',
  approve: 'canApprove',
};

/**
 * Extracts the request actor from the identity headers that `src/middleware.ts`
 * injects from the verified JWT (`x-org-id` / `x-user-id` / `x-role-type`).
 * Throws ApiError(401) if org/user are missing (should not happen post-middleware).
 */
export function authActor(req: NextRequest): { orgId: string; userId: string; roleType: string } {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  const roleType = req.headers.get('x-role-type') ?? '';
  if (!orgId || !userId) throw new ApiError('Unauthenticated', 401);
  return { orgId, userId, roleType };
}

/**
 * One module, or a list of modules of which ANY one grants access. The list form
 * is for shared lookups that several screens read (the account picker, the
 * customer list, ...). Each list lives in `lib/authz-read-scopes.ts` with the
 * reason for it written next to it.
 */
export type ModuleScope = ModuleKey | readonly ModuleKey[];

const scopeKeys = (scope: ModuleScope): readonly ModuleKey[] =>
  typeof scope === 'string' ? [scope] : scope;

/**
 * Server-side authorization check. Throws ApiError(403) unless the caller's role
 * grants `action` on `moduleKey` (or, when given a list, on at least one of the
 * listed modules). ADMIN bypasses all checks. Permissions are read fresh from the
 * DB per request (no stale-token window). Fail-closed: a missing membership or
 * permission row denies, and so does an empty list.
 */
export async function requirePermission(
  req: NextRequest,
  moduleKey: ModuleScope,
  action: Action,
  db: Db = prisma,
): Promise<void> {
  const { orgId, userId, roleType } = authActor(req);
  if (roleType === 'ADMIN') return;

  const keys = scopeKeys(moduleKey);
  const membership = keys.length === 0 ? null : await db.userOrganization.findFirst({
    where: { userId, organizationId: orgId, isActive: true },
    select: {
      role: {
        select: {
          permissions: {
            where: keys.length === 1 ? { moduleKey: keys[0] } : { moduleKey: { in: [...keys] } },
            select: { canView: true, canCreate: true, canEdit: true, canDelete: true, canApprove: true },
          },
        },
      },
    },
  });

  const rows = membership?.role?.permissions ?? [];
  const allowed = rows.some((row) => row?.[COLUMN[action]] === true);
  if (!allowed) {
    const label = keys.length === 1 ? keys[0] : `any of ${keys.join(', ')}`;
    throw new ApiError(`Forbidden: missing ${action} permission for ${label}`, 403);
  }
}

/**
 * The modules on which the caller holds `action`, for a route that filters rows
 * by module instead of refusing outright (the approvals inbox). `'ALL'` for ADMIN.
 */
export async function permittedModules(
  req: NextRequest,
  action: Action,
  db: Db = prisma,
): Promise<'ALL' | Set<ModuleKey>> {
  const { orgId, userId, roleType } = authActor(req);
  if (roleType === 'ADMIN') return 'ALL';
  const membership = await db.userOrganization.findFirst({
    where: { userId, organizationId: orgId, isActive: true },
    select: {
      role: {
        select: {
          permissions: { where: { [COLUMN[action]]: true }, select: { moduleKey: true } },
        },
      },
    },
  });
  return new Set((membership?.role?.permissions ?? []).map((row) => row.moduleKey));
}

/**
 * May this caller post outside the transaction-date window?
 *
 * Mapped onto SETTINGS/edit rather than a permission of its own, because that
 * is the right which edits the window: anyone holding it can widen the policy
 * to anything, so a separate flag would restrain nobody while adding a second
 * place to look. It is also the right that closes a period — the same person,
 * by design.
 *
 * Never throws. A caller without the right simply gets the window, which is
 * the safe answer for every automated path (no request, no override).
 */
export async function canOverrideTransactionDate(
  req: NextRequest,
  db: Db = prisma,
): Promise<boolean> {
  try {
    await requirePermission(req, 'SETTINGS', 'edit', db);
    return true;
  } catch {
    return false;
  }
}

export type PermissionDescriptor = { module: ModuleScope; action: Action };

/**
 * Declarative permission wrapper for an API route handler. Runs `requirePermission`
 * before the handler, reusing `withHandler`'s error handling (so a denied request
 * returns a clean 403 JSON response and never reaches the handler). The descriptor
 * may be static or a function of the request/context. `module` may be a list, in
 * which case a grant on any one of the listed modules is enough.
 */
export function withPermission<TContext = unknown>(
  descriptor: PermissionDescriptor | ((req: NextRequest, ctx: TContext) => PermissionDescriptor),
  handler: (req: NextRequest, ctx: TContext) => Promise<NextResponse>,
) {
  return withHandler<TContext>(async (req, ctx) => {
    const d = typeof descriptor === 'function' ? descriptor(req, ctx) : descriptor;
    await requirePermission(req, d.module, d.action);
    return handler(req, ctx);
  });
}

/**
 * Platform-superadmin gate for system-global operations (e.g. full-database
 * backups). These are NOT per-tenant: a backup dump contains every org's data,
 * so they must not be reachable through an org-scoped permission a tenant admin
 * can grant their own role. Authorization is by an env allowlist of emails
 * (`PLATFORM_ADMIN_EMAILS`, comma-separated) that tenant admins cannot edit.
 *
 * Fail-closed: if no allowlist is configured the operation is denied outright —
 * disabling backups is safer than leaving them tenant-exploitable. Set
 * PLATFORM_ADMIN_EMAILS to the operator email(s) to enable them.
 */
export async function requirePlatformAdmin(req: NextRequest, db: Db = prisma): Promise<void> {
  const { userId } = authActor(req);
  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) {
    throw new ApiError('Operation disabled: no platform administrators are configured', 403);
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = user?.email?.toLowerCase();
  if (!email || !allow.includes(email)) {
    throw new ApiError('Forbidden: platform administrator access required', 403);
  }
}

/**
 * Declarative platform-superadmin wrapper. Runs `requirePlatformAdmin` before the
 * handler, reusing `withHandler`'s error handling (a denied request returns a
 * clean 403 and never reaches the handler).
 */
export function withPlatformAdmin<TContext = unknown>(
  handler: (req: NextRequest, ctx: TContext) => Promise<NextResponse>,
) {
  return withHandler<TContext>(async (req, ctx) => {
    await requirePlatformAdmin(req);
    return handler(req, ctx);
  });
}
