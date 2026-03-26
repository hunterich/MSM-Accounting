import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * POST /api/v1/item-categories/:id/next-sku
 * Atomically increments the skuSequence counter for the category and
 * returns the next available SKU string: "{CODE}-{NNNN}".
 * Using update+increment is safe against concurrent requests.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId  = req.headers.get('x-org-id')!;
  const existing = await prisma.itemCategory.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  const updated = await prisma.itemCategory.update({
    where: { id },
    data:  { skuSequence: { increment: 1 } },
  });
  const seq = String(updated.skuSequence).padStart(4, '0');
  return ok({ sku: `${updated.code}-${seq}` });
}
