import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, err, ok, listResponse, nextNumber, logAudit, parsePaginationParams, validateForeignKey } from '@/lib/api-utils';
import { stockAdjustmentInputSchema } from '@/types/api';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const where: any = { organizationId: orgId };
  const [data, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, sku: true } } },
        },
      },
    }),
    prisma.stockAdjustment.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = stockAdjustmentInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid stock adjustment payload', 400);
  }
  const { lines, date, type, reason, notes, warehouseId, status } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    if (warehouseId) {
      await validateForeignKey(tx.warehouse, { id: warehouseId, organizationId: orgId }, 'Warehouse not found in organization');
    }
    for (const line of lines) {
      await validateForeignKey(tx.item, { id: line.itemId, organizationId: orgId, isActive: true }, 'Item not found in organization');
    }

    const number = await nextNumber(tx, 'StockAdjustment', 'number', 'ADJ');
    const adj = await tx.stockAdjustment.create({
      data: {
        organizationId: orgId,
        number,
        date: new Date(date),
        type,
        reason,
        notes: notes ?? null,
        warehouseId: warehouseId ?? null,
        status,
      },
    });

    if (lines.length > 0) {
      await tx.stockAdjustmentLine.createMany({
        data: lines.map((l, idx: number) => ({
          stockAdjustmentId: adj.id,
          lineNo: l.lineNo ?? idx + 1,
          itemId: l.itemId,
          accountId: l.accountId ?? null,
          oldQty: l.oldQty,
          newQty: l.newQty,
          qtyDiff: l.qtyDiff ?? (Number(l.newQty) - Number(l.oldQty)),
          unitCost: l.unitCost,
          totalValue: l.totalValue ?? ((Number(l.newQty) - Number(l.oldQty)) * Number(l.unitCost)),
        })),
      });

      // Write the perpetual inventory ledger + balancing GL entry. Shared with
      // the integration tests via lib/stock-adjustment-posting.ts.
      await postStockAdjustmentToLedger(tx, orgId, {
        id: adj.id,
        number: adj.number,
        date: new Date(date),
        warehouseId: warehouseId ?? null,
        lines,
      });
    }

    return tx.stockAdjustment.findUnique({
      where: { id: adj.id },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, sku: true } } },
        },
      },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: result!.id, action: 'CREATE', payload: { number: result!.number } });
  return ok(result, 201);
});
