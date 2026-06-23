import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok } from '@/lib/api-utils';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!count) return err('Stock count not found', 404);
  if (count.status !== 'SUBMITTED') return err(`Cannot reopen a ${count.status} count`, 400);
  const updated = await prisma.stockCount.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null } });
  return ok(updated);
}
