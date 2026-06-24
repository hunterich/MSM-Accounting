// POST /api/v1/sales-returns/[id]/void
// Reverses a posted sales return's inventory journal entry, removes the restock
// it added (blocking if re-sold), and marks it VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidSalesReturn } from '@/lib/return-void';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const salesReturn = await prisma.$transaction(async (tx) => {
    await voidSalesReturn(tx, orgId, id, { date });
    return tx.salesReturn.findFirst({
      where: { id, organizationId: orgId },
      include: { customer: { select: { id: true, name: true, code: true } }, lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: id, action: 'VOID', payload: null });
  return ok(salesReturn);
});
