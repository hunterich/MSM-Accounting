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
 * Server-side authorization check. Throws ApiError(403) unless the caller's role
 * grants `action` on `moduleKey`. ADMIN bypasses all checks. Permissions are read
 * fresh from the DB per request (no stale-token window). Fail-closed: a missing
 * membership or permission row denies.
 */
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
    select: {
      role: {
        select: {
          permissions: {
            where: { moduleKey },
            select: { canView: true, canCreate: true, canEdit: true, canDelete: true, canApprove: true },
          },
        },
      },
    },
  });

  const allowed = membership?.role?.permissions?.[0]?.[COLUMN[action]] ?? false;
  if (!allowed) {
    throw new ApiError(`Forbidden: missing ${action} permission for ${moduleKey}`, 403);
  }
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

export type PermissionDescriptor = { module: ModuleKey; action: Action };

/**
 * Declarative permission wrapper for an API route handler. Runs `requirePermission`
 * before the handler, reusing `withHandler`'s error handling (so a denied request
 * returns a clean 403 JSON response and never reaches the handler). The descriptor
 * may be static or a function of the request/context.
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
