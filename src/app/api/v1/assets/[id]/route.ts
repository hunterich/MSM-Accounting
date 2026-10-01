import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg, validateForeignKey, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateAssetInputSchema } from '@/types/api';
import { lockAssetPurchases } from '@/lib/asset-purchases';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);
  const { id } = await params;

  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    include: {
      category: true,
      purchaseLine: { select: { billId: true, bill: { select: { id: true, number: true, status: true } } } },
      depreciationEntries: {
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      },
    },
  });
  if (!asset) throw new ApiError('Asset not found', 404);

  return ok(asset);
});

export const PUT = withPermission({ module: 'GL_JOURNAL', action: 'edit' }, async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);
  const { id } = await params;
  const body = await req.json();
  const parsed = updateAssetInputSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  const updated = await prisma.$transaction(async tx => {
  await lockAssetPurchases(tx, orgId);
  const existing = await tx.asset.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, status: true, purchaseLine: true, acquisitionCost: true },
  });
  if (!existing) throw new ApiError('Asset not found', 404);
  if (existing.purchaseLine && parsed.data.salvageValue !== undefined && parsed.data.salvageValue > Number(existing.acquisitionCost)) {
    throw new ApiError('Salvage value cannot exceed asset cost.', 422);
  }
  if (existing.purchaseLine && ['categoryId', 'acquisitionDate', 'acquisitionCost'].some(key => key in parsed.data)) {
    throw new ApiError('Edit the source bill to change a purchased asset’s category, date, or cost.', 422);
  }
  if (existing.status !== 'DRAFT' && existing.status !== 'ACTIVE') {
    throw new ApiError('Can only edit DRAFT or ACTIVE assets', 422);
  }

  // Tenant-isolation guard: a reassigned category must belong to this org.
  if (parsed.data.categoryId) {
    await validateForeignKey(
      tx.assetCategory,
      { id: parsed.data.categoryId, organizationId: orgId },
      'Asset category not found in organization',
    );
  }

  const updateData: any = { ...parsed.data };
  if (updateData.acquisitionDate) {
    updateData.acquisitionDate = new Date(updateData.acquisitionDate);
  }

  return tx.asset.update({
    where: { id },
    data: updateData,
    include: { category: { select: { id: true, name: true } } },
  });
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Asset',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(updated);
});

export const DELETE = withPermission({ module: 'GL_JOURNAL', action: 'delete' }, async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);
  const { id } = await params;

  await prisma.$transaction(async tx => {
  await lockAssetPurchases(tx, orgId);
  const existing = await tx.asset.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, status: true, purchaseLine: { include: { bill: true } } },
  });
  if (!existing) throw new ApiError('Asset not found', 404);
  if (existing.status !== 'DRAFT') {
    throw new ApiError('Can only delete DRAFT assets', 422);
  }
  if (existing.purchaseLine && !existing.purchaseLine.bill.deletedAt && existing.purchaseLine.bill.status !== 'VOID') throw new ApiError('Delete the draft source bill to cancel this asset purchase.', 422);

  // Soft delete
  await tx.asset.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Asset',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ deleted: true });
});
