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
  const account = await prisma.account.findFirst({
    where: { id, organizationId: orgId },
    include: { children: true, parent: true },
  });
  if (!account) return err('Not found', 404);
  return ok(account);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const account = await prisma.account.update({
    where: { id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Account', entityId: id, action: 'UPDATE', payload: body });
  return ok(account);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  // Verify ownership before checking for children
  const account = await prisma.account.findFirst({ where: { id, organizationId: orgId } });
  if (!account) return err('Not found', 404);
  const childCount = await prisma.account.count({ where: { parentId: id, organizationId: orgId } });
  if (childCount > 0) return err('Cannot delete account with sub-accounts', 400);
  await prisma.account.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Account', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
