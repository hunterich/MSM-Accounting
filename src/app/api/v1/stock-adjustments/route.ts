// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, ok, listResponse, nextNumber, logAudit, validateForeignKey } from '@/lib/api-utils';
import { stockAdjustmentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(100, Number(searchParams.get('limit') ?? 20));
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
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const body = await req.json();
  const parsed = stockAdjustmentInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid stock adjustment payload', 400);
  }
  const { lines, date, type, reason, notes, warehouseId, status } = parsed.data;

  try {
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

    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: result!.id, action: 'CREATE', payload: { number: result!.number } });
    return ok(result, 201);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to create stock adjustment';
    return err(message, 500);
  }
}
