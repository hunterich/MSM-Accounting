import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { resolveItemGroups, type GroupWithAttach } from '@/lib/pos/modifier-resolution';

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const items = await prisma.item.findMany({
    where: { organizationId: orgId, isActive: true, type: 'PRODUCT' },
    select: { id: true, sku: true, name: true, barcode: true, sellingPrice: true, drugClass: true, requiresBatchTracking: true, categoryId: true },
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

  const salesTypes = await prisma.salesType.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, name: true, channel: true, serviceChargePct: true, taxable: true },
    orderBy: { sortOrder: 'asc' },
  });

  const groups = await prisma.modifierGroup.findMany({
    where: { organizationId: orgId, isActive: true },
    include: { options: true, attachments: { select: { itemId: true, itemCategoryId: true } } },
  });
  const groupData: GroupWithAttach[] = groups.map((g) => ({
    id: g.id, name: g.name, selectionType: g.selectionType, isRequired: g.isRequired,
    sortOrder: g.sortOrder, isActive: g.isActive,
    options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.priceDelta), itemId: o.itemId, sortOrder: o.sortOrder, isActive: o.isActive })),
    attachedItemIds: g.attachments.filter((a) => a.itemId).map((a) => a.itemId!),
    attachedCategoryIds: g.attachments.filter((a) => a.itemCategoryId).map((a) => a.itemCategoryId!),
  }));

  return ok({
    items: items.map((it) => ({
      ...it,
      sellingPrice: Number(it.sellingPrice),
      qtyAvailable: stockByItem.get(it.id) ?? 0,
      earliestExpiry: expiryByItem.get(it.id)?.toISOString() ?? null,
      modifierGroups: resolveItemGroups(groupData, { itemId: it.id, categoryId: it.categoryId ?? null }),
    })),
    salesTypes: salesTypes.map((s) => ({
      id: s.id,
      name: s.name,
      channel: s.channel,
      serviceChargePct: Number(s.serviceChargePct),
      taxable: s.taxable,
    })),
  });
});
