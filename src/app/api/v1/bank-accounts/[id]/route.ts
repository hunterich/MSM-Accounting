// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await prisma.bankAccount.findUnique({
    where: { id: id },
    include: { _count: { select: { transactions: true } } },
  });
  if (!account) return err('Not found', 404);
  return ok(account);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const account = await prisma.bankAccount.update({
    where: { id: id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
  });
  return ok(account);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  await prisma.bankAccount.delete({ where: { id: id, organizationId: orgId } });
  return ok({ deleted: true });
}
