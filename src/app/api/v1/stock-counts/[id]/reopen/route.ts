import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { ApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withPermission({ module: 'INV_ADJ', action: 'edit' }, async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await params;
  const count = await prisma.stockCount.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!count) throw new ApiError('Stock count not found', 404);
  if (count.status !== 'SUBMITTED') throw new ApiError(`Cannot reopen a ${count.status} count`, 400);
  const updated = await prisma.stockCount.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null } });
  return ok(updated);
});
