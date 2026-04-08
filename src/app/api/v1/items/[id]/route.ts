import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, logAudit, softDelete, validateForeignKey } from '@/lib/api-utils';
import { updateItemInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const item = await prisma.item.findFirst({ where: { id, organizationId: orgId }, include: { category: { select: { id: true, name: true, code: true } } } });
  if (!item) return err('Not found', 404);
  return ok(item);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();
    const parsed = updateItemInputSchema.safeParse({
      ...body,
      type: typeof body.type === 'string' ? String(body.type).trim().toUpperCase().replace(/[\s-]+/g, '_') : body.type,
    });
    if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid item payload', 400);

    if (parsed.data.categoryId) {
      await validateForeignKey(prisma.itemCategory, { id: parsed.data.categoryId, organizationId: orgId, isActive: true }, 'Item category not found in organization');
    }
    if (parsed.data.inventoryAccountId) {
      await validateForeignKey(prisma.account, { id: parsed.data.inventoryAccountId, organizationId: orgId, isActive: true }, 'Inventory account not found in organization');
    }
    if (parsed.data.revenueAccountId) {
      await validateForeignKey(prisma.account, { id: parsed.data.revenueAccountId, organizationId: orgId, isActive: true }, 'Revenue account not found in organization');
    }
    if (parsed.data.cogsAccountId) {
      await validateForeignKey(prisma.account, { id: parsed.data.cogsAccountId, organizationId: orgId, isActive: true }, 'COGS account not found in organization');
    }

    const isActive = parsed.data.isActive ?? (
      typeof body.status === 'string'
        ? !['INACTIVE', 'Inactive'].includes(String(body.status).trim())
        : undefined
    );

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (parsed.data.sku !== undefined) updateData.sku = parsed.data.sku;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.categoryId !== undefined) updateData.categoryId = parsed.data.categoryId || null;
    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.unit !== undefined) updateData.unit = parsed.data.unit;
    if (parsed.data.purchaseUnit !== undefined) updateData.purchaseUnit = parsed.data.purchaseUnit || null;
    if (parsed.data.purchaseConversionFactor !== undefined) updateData.purchaseConversionFactor = parsed.data.purchaseConversionFactor;
    if (parsed.data.sellUnit !== undefined) updateData.sellUnit = parsed.data.sellUnit || null;
    if (parsed.data.sellConversionFactor !== undefined) updateData.sellConversionFactor = parsed.data.sellConversionFactor;
    if (parsed.data.barcode !== undefined) updateData.barcode = parsed.data.barcode?.trim() || null;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description?.trim() || null;
    if (parsed.data.weight !== undefined) updateData.weight = parsed.data.weight;
    if (parsed.data.cost !== undefined || parsed.data.costPrice !== undefined) updateData.costPrice = parsed.data.costPrice ?? parsed.data.cost;
    if (parsed.data.price !== undefined || parsed.data.sellingPrice !== undefined) updateData.sellingPrice = parsed.data.sellingPrice ?? parsed.data.price;
    if (parsed.data.openingStock !== undefined) updateData.openingStock = parsed.data.openingStock;
    if (parsed.data.reorderPoint !== undefined) updateData.reorderPoint = parsed.data.reorderPoint;
    if (parsed.data.inventoryAccountId !== undefined) updateData.inventoryAccountId = parsed.data.inventoryAccountId || null;
    if (parsed.data.revenueAccountId !== undefined) updateData.revenueAccountId = parsed.data.revenueAccountId || null;
    if (parsed.data.cogsAccountId !== undefined) updateData.cogsAccountId = parsed.data.cogsAccountId || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (Object.keys(updateData).length === 1) return err('No changes provided', 400);

    const item = await prisma.item.update({
      where: { id, organizationId: orgId },
      data: updateData,
      include: { category: { select: { id: true, name: true, code: true } } },
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: id, action: 'UPDATE', payload: updateData });
    return ok(item);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to update item';
    return err(message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const deleted = await softDelete(
    prisma.item,
    { id, organizationId: orgId, isActive: true },
    { isActive: false, updatedAt: new Date() },
  );
  if (!deleted) return err('Not found', 404);
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
