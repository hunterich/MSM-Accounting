// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, listResponse, nextNumber, logAudit } from '@/lib/api-utils';

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
  const body = await req.json();
  const { lines, date, type, reason, notes, warehouseId } = body;

  const result = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'StockAdjustment', 'number', 'ADJ');
    const adj = await tx.stockAdjustment.create({
      data: {
        organizationId: orgId,
        number,
        date: new Date(date),
        type: type ?? 'QUANTITY',
        reason,
        notes,
        warehouseId: warehouseId ?? null,
        status: 'DRAFT',
      },
    });

    if (lines && lines.length > 0) {
      await tx.stockAdjustmentLine.createMany({
        data: lines.map((l: any, idx: number) => ({
          stockAdjustmentId: adj.id,
          lineNo: l.lineNo ?? idx + 1,
          itemId: l.itemId,
          accountId: l.accountId ?? null,
          oldQty: l.oldQty ?? 0,
          newQty: l.newQty ?? 0,
          qtyDiff: l.qtyDiff ?? ((l.newQty ?? 0) - (l.oldQty ?? 0)),
          unitCost: l.unitCost ?? 0,
          totalValue: l.totalValue ?? 0,
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
}
