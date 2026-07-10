import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireAuth, withHandler } from '@/lib/api-utils';
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
 * Deliberately guarded by the coarse `roleType === 'ADMIN'` claim rather than
 * withPermission: company creation is an owner capability ABOVE module RBAC —
 * there is no per-module permission a tenant role could hold for an org that
 * does not exist yet. The middleware stamps x-role-type from the signed
 * membership list, so this header is trusted.
 */
export const POST = withHandler(async function POST(req: NextRequest) {
  const { userId } = requireAuth(req);
  if (req.headers.get('x-role-type') !== 'ADMIN') {
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
