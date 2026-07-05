import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const items = await prisma.item.findMany({
    where: { organizationId: orgId, isActive: true, type: 'PRODUCT' },
    select: { id: true, sku: true, name: true, barcode: true, sellingPrice: true, drugClass: true, requiresBatchTracking: true },
    orderBy: { name: 'asc' },
  });

  const batches = await prisma.stockBatch.groupBy({
    by: ['itemId'],
    where: { organizationId: orgId, qtyOnHand: { gt: 0 } },
    _sum: { qtyOnHand: true },
    _min: { expiryDate: true },
  });
  const stockByItem = new Map(batches.map((b) => [b.itemId, Number(b._sum.qtyOnHand ?? 0)]));
  const expiryByItem = new Map(batches.map((b) => [b.itemId, b._min.expiryDate ?? null]));

  return ok(items.map((it) => ({
    ...it,
    sellingPrice: Number(it.sellingPrice),
    qtyAvailable: stockByItem.get(it.id) ?? 0,
    earliestExpiry: expiryByItem.get(it.id)?.toISOString() ?? null,
  })));
});
