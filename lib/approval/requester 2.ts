import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

/**
 * Resolve the requester that will own any held ApprovalRequest created during a
 * batch generation run.
 *
 * Batch endpoints (recurring invoices/bills "run all due", subscription
 * invoice generation) can be triggered by a user (admin) via the UI OR, in
 * principle, by a scheduler with no user header (today nothing schedules them —
 * instrumentation.ts only boots the backup scheduler — but we must not assume
 * that forever). These templates/subscriptions carry no createdById, so the
 * deterministic fallback is the org's ADMIN user (UserOrganization → Role with
 * roleType 'ADMIN'). ApprovalRequest.requestedById is a required FK, so we MUST
 * resolve a real user before routing — never skip gating for lack of one, which
 * would reintroduce the approval bypass.
 *
 * @param what  short label for the error message, e.g. "recurring invoices",
 *              "recurring bills", "subscription invoices".
 */
export async function resolveRequesterId(
  orgId: string,
  headerUserId: string | null,
  what: string,
): Promise<string> {
  if (headerUserId) return headerUserId;
  const adminMembership = await prisma.userOrganization.findFirst({
    where: { organizationId: orgId, role: { roleType: 'ADMIN' } },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (!adminMembership) {
    throw new ApiError(
      `Cannot generate ${what}: no requesting user (x-user-id) and no admin user to attribute approval requests to`,
      401,
    );
  }
  return adminMembership.userId;
}
