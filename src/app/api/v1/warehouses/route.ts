import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { warehouseInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseWarehousePayload(orgId: string, body: unknown) {
  const parsed = warehouseInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid warehouse payload', 400);
  }

  return {
    ...parsed.data,
    code: parsed.data.code.toUpperCase(),
  };
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const data = await prisma.warehouse.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
  });

  return ok(data);
});

export const POST = withPermission({ module: 'INV_ITEMS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const payload = parseWarehousePayload(orgId, body);

  const warehouse = await prisma.warehouse.create({
    data: payload,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Warehouse',
    entityId: warehouse.id,
    action: 'CREATE',
    payload: body,
  });

  return ok(warehouse, 201);
});
