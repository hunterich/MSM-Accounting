import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

import { submitInvoiceForApproval } from '@/lib/approval/invoice-submission';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AR_INVOICES', action: 'edit' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) return err('Unauthenticated', 401);

  const approvalRequestId = await prisma.$transaction(tx => submitInvoiceForApproval(tx, orgId, userId, id));

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'SalesInvoice',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'submit-approval', approvalRequestId },
  });

  return ok({ success: true, approvalRequestId });
});
