import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireAuth, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { marketplaceImportInputSchema } from '@/types/api';
import { importMarketplaceOrders } from '@/lib/marketplace-import';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'AR_INVOICES', action: 'create' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { orgId, userId } = requireAuth(req);
    const { id } = await params;
    const body = await req.json();
    const parsed = marketplaceImportInputSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message || 'Invalid import payload', 400);
    }
    const result = await importMarketplaceOrders(
      orgId,
      userId,
      id,
      parsed.data.orders,
      parsed.data.options,
    );
    return ok(result, 200);
  },
);
