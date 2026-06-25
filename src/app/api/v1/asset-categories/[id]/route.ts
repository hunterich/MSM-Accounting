import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateAssetCategoryInputSchema } from '@/types/api';

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

  const category = await prisma.assetCategory.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { assets: true } } },
  });
  if (!category) throw new ApiError('Category not found', 404);

  return ok(category);
});

export const PUT = withPermission({ module: 'GL_JOURNAL', action: 'edit' }, async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);
  const { id } = await params;
  const body = await req.json();
  const parsed = updateAssetCategoryInputSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  const existing = await prisma.assetCategory.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) throw new ApiError('Category not found', 404);

  const updated = await prisma.assetCategory.update({
    where: { id },
    data: parsed.data,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AssetCategory',
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

  const existing = await prisma.assetCategory.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { assets: true } } },
  });
  if (!existing) throw new ApiError('Category not found', 404);
  if (existing._count.assets > 0) {
    throw new ApiError('Cannot delete category with existing assets', 422);
  }

  await prisma.assetCategory.delete({ where: { id } });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AssetCategory',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ deleted: true });
});
