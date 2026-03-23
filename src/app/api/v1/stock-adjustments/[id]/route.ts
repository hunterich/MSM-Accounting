// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id: id },
    include: {
      lines: {
        include: { item: true },
      },
    },
  });
  if (!adj) return err('Not found', 404);
  return ok(adj);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const { lines, ...header } = body;
  const existing = await prisma.stockAdjustment.findUnique({ where: { id: id } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT adjustments can be edited', 400);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.stockAdjustment.update({
      where: { id: id, organizationId: orgId },
      data: { ...header, updatedAt: new Date() },
    });
    if (lines) {
      await tx.stockAdjustmentLine.deleteMany({ where: { stockAdjustmentId: id } });
      await tx.stockAdjustmentLine.createMany({
        data: lines.map((l: any, idx: number) => ({
          ...l,
          stockAdjustmentId: id,
          lineNo: l.lineNo ?? idx + 1,
        })),
      });
    }
    return tx.stockAdjustment.findUnique({
      where: { id: id },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, sku: true } } },
        },
      },
    });
  });
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  const existing = await prisma.stockAdjustment.findUnique({ where: { id: id } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT adjustments can be deleted', 400);
  await prisma.stockAdjustment.delete({ where: { id: id, organizationId: orgId } });
  logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
