import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateAssetInputSchema } from '@/types/api';

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

  const existing = await prisma.asset.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new ApiError('Asset not found', 404);
  if (existing.status !== 'DRAFT' && existing.status !== 'ACTIVE') {
    throw new ApiError('Can only edit DRAFT or ACTIVE assets', 422);
  }

  const updateData: any = { ...parsed.data };
  if (updateData.acquisitionDate) {
    updateData.acquisitionDate = new Date(updateData.acquisitionDate);
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: updateData,
    include: { category: { select: { id: true, name: true } } },
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

  const existing = await prisma.asset.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new ApiError('Asset not found', 404);
  if (existing.status !== 'DRAFT') {
    throw new ApiError('Can only delete DRAFT assets', 422);
  }

  // Soft delete
  await prisma.asset.update({
    where: { id },
    data: { deletedAt: new Date() },
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
