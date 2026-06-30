import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { assetCategoryInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Tenant-isolation guard: every GL account a category references must belong to
 * the caller's org. Without this a category could wire in another org's account,
 * which later drives disposal/depreciation JE posting (cross-tenant reference).
 * One query validates all three optional account FKs.
 */
async function assertCategoryAccountsInOrg(
  orgId: string,
  data: { assetAccountId?: string | null; depExpenseAccountId?: string | null; accumDepAccountId?: string | null },
) {
  const ids = [data.assetAccountId, data.depExpenseAccountId, data.accumDepAccountId]
    .filter((x): x is string => Boolean(x));
  if (ids.length === 0) return;
  const found = await prisma.account.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true },
  });
  const foundIds = new Set(found.map((a) => a.id));
  for (const id of ids) {
    if (!foundIds.has(id)) throw new ApiError('Selected GL account was not found in this organization', 404);
  }
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 100 });
  const search = searchParams.get('search');

  const where: any = { organizationId: orgId };
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.assetCategory.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: true } } },
    }),
    prisma.assetCategory.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'GL_JOURNAL', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = assetCategoryInputSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  await assertCategoryAccountsInOrg(orgId, parsed.data);

  const category = await prisma.assetCategory.create({
    data: parsed.data,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AssetCategory',
    entityId: category.id,
    action: 'CREATE',
    payload: { name: category.name },
  });

  return ok(category, 201);
});
