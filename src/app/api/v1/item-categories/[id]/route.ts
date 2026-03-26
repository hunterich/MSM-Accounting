import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';

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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId  = req.headers.get('x-org-id')!;
  const existing = await prisma.itemCategory.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  const body = await req.json();
  const category = await prisma.itemCategory.update({
    where: { id },
    data: {
      ...(body.name        !== undefined && { name:        body.name }),
      ...(body.code        !== undefined && { code:        (body.code as string).toUpperCase() }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.isActive    !== undefined && { isActive:    body.isActive }),
      updatedAt: new Date(),
    },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ItemCategory', entityId: id, action: 'UPDATE', payload: body });
  return ok(category);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId  = req.headers.get('x-org-id')!;
  const existing = await prisma.itemCategory.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  // Detach items from this category before deleting
  await prisma.item.updateMany({ where: { categoryId: id, organizationId: orgId }, data: { categoryId: null } });
  await prisma.itemCategory.delete({ where: { id } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ItemCategory', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
