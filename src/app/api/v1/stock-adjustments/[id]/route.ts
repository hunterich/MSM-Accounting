import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, logAudit, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateStockAdjustmentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const adj = await prisma.stockAdjustment.findFirst({
    where: { id, organizationId: orgId },
    include: {
      lines: {
        include: { item: true },
      },
    },
  });
  if (!adj) return err('Not found', 404);
  return ok(adj);
}

export const PUT = withPermission({ module: 'INV_ADJ', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateStockAdjustmentInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid stock adjustment payload', 400);
  const { lines, ...header } = parsed.data;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockAdjustment.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) return null;
      if (existing.status !== 'DRAFT') {
        throw new ApiError('Only DRAFT adjustments can be edited', 400);
      }
      if (header.warehouseId) {
        await validateForeignKey(tx.warehouse, { id: header.warehouseId, organizationId: orgId }, 'Warehouse not found in organization');
      }
      if (lines) {
        for (const line of lines) {
          await validateForeignKey(tx.item, { id: line.itemId, organizationId: orgId, isActive: true }, 'Item not found in organization');
        }
      }
      await tx.stockAdjustment.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          ...(header.date !== undefined && { date: new Date(header.date) }),
          updatedAt: new Date(),
        },
      });
      if (lines) {
        await tx.stockAdjustmentLine.deleteMany({ where: { stockAdjustmentId: id } });
        await tx.stockAdjustmentLine.createMany({
          data: lines.map((l, idx: number) => ({
            stockAdjustmentId: id,
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
      return tx.stockAdjustment.findFirst({
        where: { id, organizationId: orgId },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, sku: true } } },
          },
        },
      });
    });
    if (!updated) return err('Not found', 404);
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: id, action: 'UPDATE', payload: body });
    return ok(updated);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to update stock adjustment';
    return err(message, 500);
  }
});

export const DELETE = withPermission({ module: 'INV_ADJ', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.stockAdjustment.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT adjustments can be deleted', 400);
  // Posting fires on create whenever there are lines, regardless of status — so a
  // DRAFT adjustment may already have GL + inventory movements. Deleting it would
  // orphan them; require a void instead. (Detected via its inventory ledger rows.)
  const postedMovements = await prisma.inventoryLedgerEntry.count({
    where: { organizationId: orgId, documentType: 'ADJUSTMENT', documentId: id },
  });
  if (postedMovements > 0) {
    return err('Cannot delete a posted stock adjustment — void it instead', 422);
  }
  await prisma.stockAdjustment.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
});
