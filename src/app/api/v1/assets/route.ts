import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { assetInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');
  const categoryId = searchParams.get('categoryId');
  const search = searchParams.get('search');

  const where: any = { organizationId: orgId, deletedAt: null };
  if (status) where.status = status;
  if (categoryId) where.categoryId = categoryId;
  if (search) {
    where.OR = [
      { assetNo: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { category: { select: { id: true, name: true } } },
    }),
    prisma.asset.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = assetInputSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  const asset = await prisma.$transaction(async (tx: any) => {
    // Generate asset number
    const countResult = await tx.$queryRaw`
      SELECT MAX(CAST(SUBSTRING("assetNo" FROM '[0-9]+') AS INTEGER)) AS max
      FROM "Asset"
      WHERE "organizationId" = ${orgId}
    `;
    const maxSeq = Number((countResult as any)[0]?.max ?? 0);
    const assetNo = `ASSET-${String(maxSeq + 1).padStart(6, '0')}`;

    return tx.asset.create({
      data: {
        organizationId: orgId,
        assetNo,
        name: parsed.data.name,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId,
        acquisitionDate: new Date(parsed.data.acquisitionDate),
        acquisitionCost: parsed.data.acquisitionCost,
        depreciationMethod: parsed.data.depreciationMethod,
        usefulLifeMonths: parsed.data.usefulLifeMonths,
        salvageValue: parsed.data.salvageValue,
        bookValue: parsed.data.acquisitionCost,
        location: parsed.data.location,
        custodian: parsed.data.custodian,
        department: parsed.data.department,
        serialNumber: parsed.data.serialNumber,
        vendor: parsed.data.vendor,
        status: 'DRAFT',
      },
      include: { category: { select: { id: true, name: true } } },
    });
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Asset',
    entityId: asset.id,
    action: 'CREATE',
    payload: { assetNo: asset.assetNo, name: asset.name },
  });

  return ok(asset, 201);
});
