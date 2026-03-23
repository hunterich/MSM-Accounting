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
  const item = await prisma.item.findUnique({ where: { id: id } });
  if (!item) return err('Not found', 404);
  return ok(item);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const item = await prisma.item.update({
    where: { id: id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
  });
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Item', entityId: id, action: 'UPDATE', payload: body });
  return ok(item);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  await prisma.item.delete({ where: { id: id, organizationId: orgId } });
  logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'Item', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
