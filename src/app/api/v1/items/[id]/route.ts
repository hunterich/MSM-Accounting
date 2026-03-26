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
  const orgId = req.headers.get('x-org-id')!;
  const item = await prisma.item.findFirst({ where: { id, organizationId: orgId }, include: { category: { select: { id: true, name: true, code: true } } } });
  if (!item) return err('Not found', 404);
  return ok(item);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const { categoryId, purchaseUnit, purchaseConversionFactor, sellUnit, sellConversionFactor, ...rest } = body;
  const item = await prisma.item.update({
    where: { id, organizationId: orgId },
    data: {
      ...rest,
      updatedAt: new Date(),
      ...(categoryId !== undefined && { categoryId: categoryId || null }),
      ...(purchaseUnit !== undefined && { purchaseUnit: purchaseUnit || null }),
      ...(purchaseConversionFactor !== undefined && { purchaseConversionFactor: purchaseConversionFactor || null }),
      ...(sellUnit !== undefined && { sellUnit: sellUnit || null }),
      ...(sellConversionFactor !== undefined && { sellConversionFactor: sellConversionFactor || null }),
    },
    include: { category: { select: { id: true, name: true, code: true } } },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: id, action: 'UPDATE', payload: body });
  return ok(item);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  await prisma.item.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
