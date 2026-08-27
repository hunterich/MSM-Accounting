import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireUser, withHandler } from '@/lib/api-utils';
import { advisoryLockKey } from '@/lib/advisory-lock';
import { bootstrapOrganization } from '@/lib/organization/bootstrap';

export const runtime = 'nodejs';

const createOrganizationSchema = z.object({
  legalName: z.string().trim().min(2, 'Legal name must be at least 2 characters'),
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters'),
  npwp: z.string().trim().min(1).optional(),
  isPkp: z.boolean().optional(),
  fiscalYearStart: z.coerce.date().optional(),
});

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Create a new company from the standard template (COA, warehouse, roles,
 * periods) and make the caller its Admin.
 *
 * Deliberately guarded by role rather than withPermission: company creation is
 * an owner capability ABOVE module RBAC — there is no per-module permission a
 * tenant role could hold for an org that does not exist yet.
 *
 * The authority is derived from the caller's memberships across ALL companies,
 * not from the tab's active org, because both callers who legitimately need
 * this route may arrive with no resolvable active org (see `isOrgOptionalPath`):
 *   - a brand-new user with zero companies, bootstrapping their first one;
 *   - an admin sitting on the post-login company picker, which has not pinned
 *     a company to the tab yet.
 * Reading memberships from the DB rather than the `x-role-type` header also
 * means a role revoked since the token was issued takes effect immediately.
 */
export const POST = withHandler(async function POST(req: NextRequest) {
  const userId = requireUser(req);

  const caller = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      memberships: {
        where: { isActive: true },
        select: { role: { select: { roleType: true } } },
      },
    },
  });
  // Status is checked on the USER row, not folded into the membership filter:
  // a deactivated account has to fail here, not fall through the
  // zero-membership branch below and look like a first-time signup.
  if (!caller || caller.status !== 'ACTIVE') {
    return err('Only administrators can create companies', 403);
  }
  // Zero companies → this is the caller's first, and there is no admin who
  // could grant it to them. Otherwise they must already administer one.
  const allowed =
    caller.memberships.length === 0 ||
    caller.memberships.some((m) => m.role.roleType === 'ADMIN');
  if (!allowed) {
    return err('Only administrators can create companies', 403);
  }

  const parsed = createOrganizationSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid company payload', 400);
  }

  const { orgId } = await prisma.$transaction(async (tx) => {
    // Duplicate guard: Organization has no unique name constraint and there is
    // no delete endpoint, so an accidental double-submit would be permanent.
    // Serialize this user's creates (xact-scoped advisory lock, released at
    // commit/rollback), then refuse a legalName the caller already has.
    const lockKey = advisoryLockKey(`org-create:${userId}`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
    const duplicate = await tx.organization.findFirst({
      where: {
        legalName: parsed.data.legalName, // zod .trim() already normalized it
        memberships: { some: { userId } },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError('A company with this name already exists', 409);
    }

    return bootstrapOrganization(
      tx,
      {
        legalName: parsed.data.legalName,
        displayName: parsed.data.displayName,
        npwp: parsed.data.npwp ?? null,
        isPkp: parsed.data.isPkp ?? false,
        fiscalYearStart: parsed.data.fiscalYearStart ?? null,
      },
      userId,
    );
  });

  // Audit under the NEW org: "this company was created by X" belongs to the
  // company's own trail (its first entry).
  logAudit({
    orgId,
    actorId: userId,
    entityType: 'Organization',
    entityId: orgId,
    action: 'CREATE',
    payload: {
      legalName: parsed.data.legalName,
      displayName: parsed.data.displayName,
      npwp: parsed.data.npwp ?? null,
      isPkp: parsed.data.isPkp ?? false,
      fiscalYearStart: parsed.data.fiscalYearStart?.toISOString() ?? null,
    },
  });

  return ok({ orgId }, 201);
});
