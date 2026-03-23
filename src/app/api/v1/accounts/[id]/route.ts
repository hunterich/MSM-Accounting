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
  const account = await prisma.account.findUnique({
    where: { id: id },
    include: { children: true, parent: true },
  });
  if (!account) return err('Not found', 404);
  return ok(account);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const account = await prisma.account.update({
    where: { id: id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
  });
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Account', entityId: id, action: 'UPDATE', payload: body });
  return ok(account);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  // Check for children
  const childCount = await prisma.account.count({ where: { parentId: id } });
  if (childCount > 0) return err('Cannot delete account with sub-accounts', 400);
  await prisma.account.delete({ where: { id: id, organizationId: orgId } });
  logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'Account', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
