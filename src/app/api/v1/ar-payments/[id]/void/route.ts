// POST /api/v1/ar-payments/[id]/void
// Reverses a posted AR receipt's journal entry, drops its allocations, and
// marks it VOID. Returns the voided receipt.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { voidArPayment } from '@/lib/payment-void';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AR_PAYMENTS', action: 'delete' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const payment = await prisma.$transaction(async (tx) => {
    await voidArPayment(tx, orgId, id, { date });
    return tx.aRPayment.findFirst({ where: { id, organizationId: orgId }, include: { customer: true, allocations: true } });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: id, action: 'VOID', payload: null });
  return ok(payment);
});
