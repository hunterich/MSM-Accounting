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

  const allowed = membership?.role.permissions[0]?.[COLUMN[action]] ?? false;
  if (!allowed) {
    throw new ApiError(`Forbidden: missing ${action} permission for ${moduleKey}`, 403);
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
