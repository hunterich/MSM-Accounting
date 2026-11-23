import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withPermission } from '@/lib/authz';
import { err, ok, requireOrg } from '@/lib/api-utils';
import { prepareSalesReturnValuation } from '@/lib/sales-return-lines';
import { previewSalesReturnInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AR_CREDITS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const parsed = previewSalesReturnInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid sales return preview', 400);
  const { invoiceId, customerId, lines, returnId } = parsed.data;
  const { amounts } = await prisma.$transaction(tx => prepareSalesReturnValuation(tx, orgId, invoiceId, customerId, lines ?? [], returnId));
  return ok(amounts);
});
