import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit, softDelete } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateItemCategoryInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId  = req.headers.get('x-org-id')!;
  const category = await prisma.itemCategory.findFirst({ where: { id, organizationId: orgId } });
  if (!category) return err('Not found', 404);
  return ok(category);
}

export const PUT = withPermission({ module: 'INV_CATEGORIES', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId  = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateItemCategoryInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid item category payload', 400);
  const category = await prisma.$transaction(async (tx) => {
    const existing = await tx.itemCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return null;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.code !== undefined) updateData.code = parsed.data.code.trim().toUpperCase();
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description?.trim() || null;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (Object.keys(updateData).length === 1) return 'NO_CHANGES' as const;
    return tx.itemCategory.update({
      where: { id },
      data: updateData,
    });
  });
  if (category === 'NO_CHANGES') return err('No changes provided', 400);
  if (!category) return err('Not found', 404);
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ItemCategory', entityId: id, action: 'UPDATE', payload: parsed.data });
  return ok(category);
});

export const DELETE = withPermission({ module: 'INV_CATEGORIES', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId  = req.headers.get('x-org-id')!;
  const deleted = await prisma.$transaction(async (tx) => {
    const existing = await tx.itemCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return null;
    // Detach items from this category before deleting
    await tx.item.updateMany({ where: { categoryId: id, organizationId: orgId }, data: { categoryId: null } });
    await tx.itemCategory.updateMany({
      where: { id, organizationId: orgId, isActive: true },
      data: { isActive: false, updatedAt: new Date() },
    });
    return existing;
  });
  if (!deleted) return err('Not found', 404);
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ItemCategory', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
});
