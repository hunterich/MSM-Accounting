import { NextRequest } from 'next/server';
import { z } from 'zod';
import { corsPreflightResponse } from '@/lib/cors';
import { requireAuth, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { marketplaceImportInputSchema, marketplaceImportLineSchema, marketplaceImportOrderSchema, decimalNumber } from '@/types/api';
import { previewMarketplaceOrders } from '@/lib/marketplace-import-preview';

export const runtime = 'nodejs';

const previewInputSchema = marketplaceImportInputSchema.extend({
  orders: z.array(marketplaceImportOrderSchema.extend({
    lines: z.array(marketplaceImportLineSchema.extend({
      itemId: z.string().trim(),
      description: z.string(),
      quantity: decimalNumber,
      unitPrice: decimalNumber,
    })).min(1),
    sourceTotal: decimalNumber,
    missingDate: z.boolean().default(false),
  })).min(1),
});

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'AR_INVOICES', action: 'create' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { orgId } = requireAuth(req);
    const { id } = await params;
    const parsed = previewInputSchema.safeParse(await req.json());
    if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid import preview', 400);
    return ok(await previewMarketplaceOrders(orgId, id, parsed.data.orders, parsed.data.options));
  },
);
