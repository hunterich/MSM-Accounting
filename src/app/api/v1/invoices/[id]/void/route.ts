// POST /api/v1/invoices/[id]/void
// Reverses a posted invoice's AR + COGS journals, restores the sold stock,
// and marks it VOID. Returns the voided invoice.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { voidInvoice } from '@/lib/invoice-void';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AR_INVOICES', action: 'delete' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const invoice = await prisma.$transaction(async (tx) => {
    await voidInvoice(tx, orgId, id, { date });
    return tx.salesInvoice.findFirst({
      where: { id, organizationId: orgId },
      include: { customer: { select: { id: true, name: true, code: true } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'VOID', payload: null });
  return ok(invoice);
});
