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

/**
 * Tenant-isolation guard: every GL account a category references must belong to
 * the caller's org (otherwise a category could wire in another org's account,
 * which later drives disposal/depreciation JE posting). One query validates all
 * three optional account FKs.
 */
async function assertCategoryAccountsInOrg(
  orgId: string,
  data: { assetAccountId?: string | null; depExpenseAccountId?: string | null; accumDepAccountId?: string | null },
) {
  const ids = [data.assetAccountId, data.depExpenseAccountId, data.accumDepAccountId]
    .filter((x): x is string => Boolean(x));
  if (ids.length === 0) return;
  const found = await prisma.account.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true },
  });
  const foundIds = new Set(found.map((a) => a.id));
  for (const id of ids) {
    if (!foundIds.has(id)) throw new ApiError('Selected GL account was not found in this organization', 404);
  }
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

  await assertCategoryAccountsInOrg(orgId, parsed.data);

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
