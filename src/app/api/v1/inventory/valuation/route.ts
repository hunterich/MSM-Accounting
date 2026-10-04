import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, ApiError } from '@/lib/api-utils';
import { reportDate } from '@/lib/subledger-history';
import { withPermission } from '@/lib/authz';
import { computeLedgerValuation } from '@/lib/inventory-valuation';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get('categoryId');
  const warehouseId = searchParams.get('warehouseId');
  const asOfInput = searchParams.get('asOfDate');
  let asOfDate: Date | undefined;
  if (asOfInput) {
    try { asOfDate = reportDate(asOfInput, true); } catch { throw new ApiError(`Invalid date: ${asOfInput}`, 400); }
  }

  // Fetch all items for the org (optionally filtered by category)
  // Deactivation is an operational selection rule, not an accounting write-off.
  // Keep inactive items with residual quantity in inventory valuation.
  const itemWhere: any = {
    organizationId: orgId,
    OR: [
      { isActive: true },
      { inventoryLots: { some: { qtyBalance: { not: 0 } } } },
      ...(asOfDate ? [{ ledgerEntries: { some: { date: { lte: asOfDate } } } }] : []),
    ],
  };
  if (categoryId) itemWhere.categoryId = categoryId;

  const itemsList = await prisma.item.findMany({
    where: itemWhere,
    select: {
      id: true,
      sku: true,
      name: true,
      categoryId: true,
      costPrice: true,
      unit: true,
    },
    orderBy: { name: 'asc' },
  });

  if (itemsList.length === 0) {
    return ok({
      items: [],
      summary: { totalItems: 0, totalValue: 0 },
    });
  }

  const itemIds = itemsList.map((i) => i.id);

  // Value on-hand from the immutable inventory ledger — the same source the GL
  // inventory account is posted from — so this report reconciles to the trial
  // balance under both FIFO and weighted-average. (Open cost layers can diverge
  // from GL under WA; see lib/inventory-valuation.ts.)
  const valuationByItem = await computeLedgerValuation(prisma, orgId, {
    itemIds,
    warehouseId: warehouseId ?? null,
    asOfDate,
  });

  let summaryTotalValue = 0;

  const items = itemsList.map((item) => {
    const agg = valuationByItem.get(item.id);
    const totalQty = agg ? agg.totalQty : 0;
    const totalValue = agg ? agg.totalValue : 0;
    const costPriceFallback = Number(item.costPrice);
    const avgCost = totalQty > 0 ? totalValue / totalQty : costPriceFallback;

    summaryTotalValue += totalValue;

    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      categoryId: item.categoryId,
      unit: item.unit,
      totalQty: Math.round(totalQty * 10000) / 10000,
      totalValue: Math.round(totalValue * 100) / 100,
      avgCost: Math.round(avgCost * 100) / 100,
    };
  });

  return ok({
    items,
    summary: {
      totalItems: items.length,
      totalValue: Math.round(summaryTotalValue * 100) / 100,
    },
  });
});
