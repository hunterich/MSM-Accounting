import type { NextRequest } from 'next/server';
import type { ModuleKey, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { isApprovalAllowed } from './policy';

type Db = Prisma.TransactionClient | typeof prisma;

/** True if the user may approve documents in `moduleKey`. Admins approve everything. */
export async function userCanApprove(
  db: Db,
  orgId: string,
  userId: string,
  roleType: string,
  moduleKey: ModuleKey,
): Promise<boolean> {
  if (roleType === 'ADMIN') return true;
  const membership = await db.userOrganization.findFirst({
    where: { userId, organizationId: orgId },
    select: { role: { select: { permissions: { where: { moduleKey }, select: { canApprove: true } } } } },
  });
  return membership?.role.permissions[0]?.canApprove ?? false;
}

/** Throws ApiError(403) if the (user, document submitter) pair may not approve. */
export async function assertApprovalAuthorized(
  db: Db,
  args: {
    orgId: string;
    userId: string;
    roleType: string;
    moduleKey: ModuleKey;
    requestedById: string;
    requireDistinctApproverForAdmins: boolean;
  },
): Promise<void> {
  const hasCanApprove = await userCanApprove(db, args.orgId, args.userId, args.roleType, args.moduleKey);
  const decision = isApprovalAllowed({
    hasCanApprove,
    isSelf: args.requestedById === args.userId,
    roleType: args.roleType,
    requireDistinctApproverForAdmins: args.requireDistinctApproverForAdmins,
  });
  if (decision.allowed) return;
  if (decision.reason === 'self-approval') {
    throw new ApiError('You cannot approve a document you submitted', 403);
  }
  throw new ApiError('You do not have permission to approve this document', 403);
}

/** Header-driven org/user/role extraction for routes. */
export function approvalActor(req: NextRequest): { orgId: string; userId: string; roleType: string } {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  const roleType = req.headers.get('x-role-type') ?? '';
  if (!orgId || !userId) throw new ApiError('Unauthenticated', 401);
  return { orgId, userId, roleType };
}
