import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok } from '@/lib/api-utils';
import { ApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withHandler(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!count) throw new ApiError('Stock count not found', 404);
  if (count.status !== 'DRAFT') throw new ApiError(`Cannot submit a ${count.status} count`, 400);
  const updated = await prisma.stockCount.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
  return ok(updated);
});
