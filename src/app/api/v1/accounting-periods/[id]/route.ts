import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, withHandler } from '@/lib/api-utils';
import { accountingPeriodInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function normalizePeriodPayload(orgId: string, body: unknown) {
  const parsed = accountingPeriodInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid accounting period payload', 400);
  }

  return {
    ...parsed.data,
    startDate: new Date(parsed.data.startDate),
    endDate: new Date(parsed.data.endDate),
  };
}

async function ensureNoOverlap(orgId: string, startDate: Date, endDate: Date, excludeId?: string) {
  const overlapping = await prisma.accountingPeriod.findFirst({
    where: {
      organizationId: orgId,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, name: true },
  });

  if (overlapping) {
    throw new ApiError(`Accounting period overlaps with ${overlapping.name}`, 409);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const period = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
    include: {
      _count: {
        select: { journalEntries: true },
      },
    },
  });

  if (!period) return err('Not found', 404);
  return ok(period);
});

export const PUT = withHandler(async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const payload = normalizePeriodPayload(orgId, body);

  const existing = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, isLocked: true },
  });
  if (!existing) return err('Not found', 404);

  if ((existing.status === 'CLOSED' || existing.isLocked) && payload.status === 'OPEN') {
    throw new ApiError('Closed or locked periods cannot be reopened via update', 422);
  }

  await ensureNoOverlap(orgId, payload.startDate, payload.endDate, id);

  const period = await prisma.accountingPeriod.update({
    where: { id, organizationId: orgId },
    data: payload,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(period);
});

export const DELETE = withHandler(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const period = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, _count: { select: { journalEntries: true } } },
  });

  if (!period) return err('Not found', 404);
  if (period._count.journalEntries > 0) {
    throw new ApiError('Cannot delete an accounting period with journal entries', 400);
  }

  await prisma.accountingPeriod.delete({
    where: { id, organizationId: orgId },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AccountingPeriod',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ deleted: true });
});
