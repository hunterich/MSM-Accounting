import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'GL_JOURNAL', action: 'create' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);
  const { id } = await params;

  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, status: true, assetNo: true },
  });
  if (!asset) throw new ApiError('Asset not found', 404);
  if (asset.status !== 'DRAFT') {
    throw new ApiError('Only DRAFT assets can be activated', 422);
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: { status: 'ACTIVE' },
    include: { category: { select: { id: true, name: true } } },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Asset',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'activate', assetNo: asset.assetNo },
  });

  return ok(updated);
});
