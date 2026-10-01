import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { lockAssetPurchases } from '@/lib/asset-purchases';
import { z } from 'zod';

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

  const input = z.object({ readyForUseDate: z.string().date() }).safeParse(await req.json());
  if (!input.success) throw new ApiError('Enter a valid ready-for-use date.', 400);
  const readyForUseDate = new Date(input.data.readyForUseDate);
  const updated = await prisma.$transaction(async tx => {
    await lockAssetPurchases(tx, orgId);
    const asset = await tx.asset.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { category: true, purchaseLine: { include: { bill: true } } },
    });
    if (!asset) throw new ApiError('Asset not found', 404);
    if (asset.status !== 'DRAFT') throw new ApiError('Only DRAFT assets can be activated', 422);
    if (readyForUseDate < asset.acquisitionDate) throw new ApiError('Ready-for-use date cannot precede acquisition.', 422);
    if (asset.purchaseLine) {
      const bill = asset.purchaseLine.bill;
      if (bill.organizationId !== orgId || bill.deletedAt || bill.voidedAt || !bill.journalEntryId || !['OPEN', 'OVERDUE', 'PAID'].includes(bill.status)) {
        throw new ApiError('Post the source supplier bill before activating this asset.', 422);
      }
      const expense = await tx.account.findFirst({ where: { id: asset.category.depExpenseAccountId ?? '', organizationId: orgId, isActive: true, isPostable: true, type: 'EXPENSE' } });
      const accumulated = await tx.account.findFirst({ where: { id: asset.category.accumDepAccountId ?? '', organizationId: orgId, isActive: true, isPostable: true, type: 'ASSET' } });
      if (!expense || !accumulated) throw new ApiError('Set active depreciation-expense and accumulated-depreciation accounts on the category first.', 422);
    }
    return tx.asset.update({ where: { id }, data: { status: 'ACTIVE', readyForUseDate }, include: { category: true } });
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Asset',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'activate', assetNo: updated.assetNo, readyForUseDate: input.data.readyForUseDate },
  });

  return ok(updated);
});
