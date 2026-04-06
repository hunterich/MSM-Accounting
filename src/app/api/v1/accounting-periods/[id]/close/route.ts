import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, withHandler } from '@/lib/api-utils';
import { accountingPeriodCloseInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json().catch(() => ({}));
  const parsed = accountingPeriodCloseInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid close request', 400);
  }

  const period = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, isLocked: true },
  });
  if (!period) return err('Not found', 404);
  if (period.status === 'CLOSED' && period.isLocked === parsed.data.lock) {
    return ok({ closed: true, locked: period.isLocked });
  }

  const updated = await prisma.accountingPeriod.update({
    where: { id, organizationId: orgId },
    data: {
      status: 'CLOSED',
      isLocked: parsed.data.lock,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'close', lock: parsed.data.lock },
  });

  return ok(updated);
});
