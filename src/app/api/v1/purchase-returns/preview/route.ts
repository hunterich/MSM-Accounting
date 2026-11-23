import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withPermission } from '@/lib/authz';
import { err, ok, requireOrg } from '@/lib/api-utils';
import { preparePurchaseReturnValuation } from '@/lib/purchase-return-amounts';
import { previewPurchaseReturnInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AP_DEBITS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const parsed = previewPurchaseReturnInputSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid purchase return preview', 400);
  const { returnId, ...input } = parsed.data;
  return ok(await prisma.$transaction(tx => preparePurchaseReturnValuation(tx, orgId, input, returnId)));
});
