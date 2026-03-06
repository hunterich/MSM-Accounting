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
  const txn = await prisma.bankTransaction.findUnique({
    where: { id: id },
    include: { bankAccount: { select: { id: true, name: true } } },
  });
  if (!txn) return err('Not found', 404);
  return ok(txn);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const txn = await prisma.bankTransaction.update({
    where: { id: id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
    include: { bankAccount: { select: { id: true, name: true } } },
  });
  return ok(txn);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  await prisma.bankTransaction.delete({ where: { id: id, organizationId: orgId } });
  return ok({ deleted: true });
}
