import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, withHandler } from '@/lib/api-utils';
import { approvalActor } from '@/lib/approval/can-approve';
import { approveRequest } from '@/lib/approval/engine';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withHandler(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = approvalActor(req);
  const reqRow = await prisma.approvalRequest.findFirst({
    where: { organizationId: actor.orgId, documentType: 'INVOICE', documentId: id, status: 'PENDING' },
    orderBy: { requestedAt: 'desc' }, select: { id: true },
  });
  if (!reqRow) return err('No pending approval request found for this invoice', 404);
  await approveRequest(reqRow.id, actor);
  return ok({ success: true });
});
