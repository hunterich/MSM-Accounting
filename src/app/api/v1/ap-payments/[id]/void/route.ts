// POST /api/v1/ap-payments/[id]/void
// Reverses a posted AP payment's journal entry, drops its allocations, and
// marks it VOID. Returns the voided payment.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidApPayment } from '@/lib/payment-void';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AP_PAYMENTS', action: 'delete' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const payment = await prisma.$transaction(async (tx) => {
    await voidApPayment(tx, orgId, id, { date });
    return tx.aPPayment.findFirst({ where: { id, organizationId: orgId }, include: { vendor: true, allocations: true } });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'APPayment', entityId: id, action: 'VOID', payload: null });
  return ok(payment);
});
