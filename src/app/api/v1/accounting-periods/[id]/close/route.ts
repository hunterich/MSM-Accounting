import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { logAudit, ok, requireAuth } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { closeAccountingPeriod } from '@/lib/period-close';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Close (lock) a monthly accounting period.
 *
 * Closing is what makes `assertPeriodOpen` start refusing posts dated inside
 * the period — see lib/period-guard.ts. It is reversible via the sibling
 * /reopen route, so this is a signed-off marker rather than a one-way door.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { orgId, userId } = requireAuth(req);

  const updated = await prisma.$transaction(tx => closeAccountingPeriod(tx, orgId, userId, id));

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'close' },
  });

  return ok(updated);
});
