import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);

  const period = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!period) return err('Accounting period not found', 404);
  if (period.status === 'CLOSED') {
    throw new ApiError('Accounting period is already closed', 422);
  }

  const unpostedCount = await prisma.journalEntry.count({
    where: { organizationId: orgId, periodId: id, status: 'DRAFT' },
  });
  if (unpostedCount > 0) {
    throw new ApiError(
      `Cannot close period: ${unpostedCount} unposted journal entr${unpostedCount === 1 ? 'y' : 'ies'} must be posted first`,
      422,
    );
  }

  const updated = await prisma.accountingPeriod.update({
    where: { id, organizationId: orgId },
    data: { status: 'CLOSED', isLocked: true },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'close' },
  });

  return ok(updated);
});
