// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, withHandler } from '@/lib/api-utils';
import { warehouseInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseWarehousePayload(orgId: string, body: unknown) {
  const parsed = warehouseInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid warehouse payload', 400);
  }

  return {
    ...parsed.data,
    code: parsed.data.code.toUpperCase(),
  };
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

  const warehouse = await prisma.warehouse.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!warehouse) return err('Not found', 404);
  return ok(warehouse);
});

export const PUT = withHandler(async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const payload = parseWarehousePayload(orgId, body);

  const existing = await prisma.warehouse.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return err('Not found', 404);

  const warehouse = await prisma.warehouse.update({
    where: { id },
    data: payload,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Warehouse',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(warehouse);
});

export const DELETE = withHandler(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const warehouse = await prisma.warehouse.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      _count: {
        select: {
          salesReturns: true,
          purchaseReturns: true,
          stockAdjustments: true,
          ledgerEntries: true,
        },
      },
    },
  });

  if (!warehouse) return err('Not found', 404);

  const references =
    warehouse._count.salesReturns +
    warehouse._count.purchaseReturns +
    warehouse._count.stockAdjustments +
    warehouse._count.ledgerEntries;

  if (references > 0) {
    throw new ApiError('Cannot delete a warehouse that has inventory activity', 400);
  }

  await prisma.warehouse.delete({
    where: { id },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Warehouse',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ deleted: true });
});
