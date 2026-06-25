// POST /api/v1/bills/[id]/void
// Reverses a posted bill's GL entry, unwinds inventory it booked directly, and
// marks it VOID. Returns the voided bill.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidBill } from '@/lib/bill-void';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AP_BILLS', action: 'delete' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const bill = await prisma.$transaction(async (tx) => {
    await voidBill(tx, orgId, id, { date });
    return tx.bill.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: true, lines: true, attachments: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'VOID', payload: null });
  return ok(bill);
});
