// GET /api/v1/purchase-orders/billable-lines?vendorId=...
// Returns PO lines that have been RECEIVED but not yet fully billed for a vendor,
// so a Bill can "Ambil" (pull) them. billableQty is bounded by receivedQty — i.e.
// stock that already has a Dr Inventory / Cr GR-IR entry — so pulling them only
// posts Dr GR-IR / Cr AP and never double-counts inventory.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { toNumber } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const vendorId = new URL(req.url).searchParams.get('vendorId');
  if (!vendorId) return err('vendorId is required', 400);

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      organizationId: orgId,
      vendorId,
      status: { in: ['APPROVED', 'PARTIAL_RECEIVED', 'CLOSED'] },
    },
    select: {
      id: true,
      number: true,
      lines: {
        where: { receivedQty: { gt: 0 } },
        select: {
          id: true, lineNo: true, itemId: true, description: true,
          unit: true, price: true, discountPct: true, receivedQty: true,
          item: { select: { sku: true, name: true } },
        },
        orderBy: { lineNo: 'asc' },
      },
    },
    orderBy: { date: 'desc' },
  });

  const result: Array<Record<string, unknown>> = [];
  for (const po of pos) {
    for (const line of po.lines) {
      // Qty already billed against this PO line (exclude voided / soft-deleted bills).
      const agg = await prisma.billLine.aggregate({
        where: {
          purchaseOrderLineId: line.id,
          bill: { status: { not: 'VOID' }, deletedAt: null },
        },
        _sum: { quantity: true },
      });
      const billedQty = toNumber(agg._sum.quantity ?? 0);
      const billableQty = toNumber(line.receivedQty) - billedQty;
      if (billableQty <= 0.0001) continue;
      result.push({
        poId: po.id,
        poNumber: po.number,
        poLineId: line.id,
        itemId: line.itemId,
        sku: line.item?.sku ?? '',
        description: line.description,
        unit: line.unit,
        price: toNumber(line.price),
        discountPct: toNumber(line.discountPct),
        receivedQty: toNumber(line.receivedQty),
        billedQty,
        billableQty,
      });
    }
  }

  return ok(result);
});
