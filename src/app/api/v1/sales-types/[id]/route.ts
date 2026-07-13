import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { salesTypeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseSalesTypePayload(orgId: string, body: unknown) {
  const parsed = salesTypeInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid sales type payload', 400);
  }

  return parsed.data;
}

async function assertChargeAccountOwned(orgId: string, chargeAccountId: string | null | undefined) {
  if (!chargeAccountId) return;

  const account = await prisma.account.findFirst({
    where: { id: chargeAccountId, organizationId: orgId },
    select: { id: true },
  });

  if (!account) {
    throw new ApiError('Selected charge account was not found', 400);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const salesType = await prisma.salesType.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!salesType) return err('Not found', 404);
  return ok(salesType);
});

export const PUT = withPermission({ module: 'POS_RETAIL', action: 'edit' }, async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const existing = await prisma.salesType.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return err('Not found', 404);

  const body = await req.json();
  const parsed = parseSalesTypePayload(orgId, body);

  await assertChargeAccountOwned(orgId, parsed.chargeAccountId);

  const updated = await prisma.salesType.update({
    where: { id },
    data: {
      name: parsed.name,
      channel: parsed.channel,
      serviceChargePct: parsed.serviceChargePct,
      chargeAccountId: parsed.chargeAccountId ?? null,
      taxable: parsed.taxable,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SalesType',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(updated);
});

export const DELETE = withPermission({ module: 'POS_RETAIL', action: 'delete' }, async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const existing = await prisma.salesType.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return err('Not found', 404);

  await prisma.salesType.delete({ where: { id } });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'SalesType',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ id });
});
