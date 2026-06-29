import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

// Lightweight, UNPAGINATED index of every item (active + inactive) with just
// the fields needed for SKU cross-checking during marketplace import. The
// regular /items list clamps to maxLimit:100, which would silently hide
// inactive items beyond the first page and break inactive-product detection.
export const GET = withPermission({ module: 'INV_ITEMS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const items = await prisma.item.findMany({
    where: { organizationId: orgId },
    select: { id: true, sku: true, name: true, isActive: true },
    orderBy: { sku: 'asc' },
  });
  return ok({ data: items });
});
