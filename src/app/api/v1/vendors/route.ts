// @ts-nocheck
// Vendor model: code (required), name, category, email, phone, status (PartnerStatus)
// Unique: @@unique([organizationId, code])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, validateForeignKey, withHandler } from '@/lib/api-utils';
import { createVendorInputSchema } from '@/types/api';

export const runtime = 'nodejs';

async function buildVendorPayload(orgId: string | null, body: any) {
  if (!orgId) {
    throw new Error('Missing organization context');
  }

  const payload: any = {
    code: body.code,
    name: body.name,
    email: body.email || null,
    phone: body.phone || null,
    paymentTerms: body.paymentTerms || null,
    npwp: body.npwp || null,
    status: body.status,
    defaultApAccountId: body.defaultApAccountId || null,
  };

  if (body.categoryId !== undefined) {
    if (!body.categoryId) {
      payload.categoryId = null;
      payload.category = null;
    } else {
      await validateForeignKey(prisma.vendorCategory, { id: body.categoryId, organizationId: orgId, isActive: true }, 'Vendor category not found in organization');
      const category = await prisma.vendorCategory.findFirst({
        where: { id: body.categoryId, organizationId: orgId },
      });
      if (!category) {
        throw new ApiError('Vendor category not found in organization', 404);
      }
      payload.categoryId = category.id;
      payload.category = category.name;
      if (!payload.paymentTerms && category.defaultPaymentTerms) {
        payload.paymentTerms = category.defaultPaymentTerms;
      }
      if (!payload.defaultApAccountId && category.defaultApAccountId) {
        payload.defaultApAccountId = category.defaultApAccountId;
      }
    }
  } else if (body.category !== undefined) {
    payload.category = body.category || null;
  }

  return payload;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');
  const status = searchParams.get('status'); // ACTIVE | INACTIVE
  const categoryId = searchParams.get('categoryId');

  const where: any = { organizationId: orgId };
  where.status = status || 'ACTIVE';
  if (categoryId) where.categoryId = categoryId;
  if (search) where.OR = [
    { name:  { contains: search, mode: 'insensitive' } },
    { code:  { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
    { category: { contains: search, mode: 'insensitive' } },
    { vendorCategory: { name: { contains: search, mode: 'insensitive' } } },
  ];

  const [data, total] = await Promise.all([
    prisma.vendor.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { name: 'asc' },
      include: {
        vendorCategory: {
          select: { id: true, name: true, code: true, defaultPaymentTerms: true, defaultApAccountId: true },
        },
      },
    }),
    prisma.vendor.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const parsed = createVendorInputSchema.safeParse({
    ...body,
    status: typeof body.status === 'string' ? String(body.status).trim().toUpperCase() : body.status,
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid vendor payload', 400);

  await validateForeignKey(prisma.account, { id: parsed.data.defaultApAccountId, organizationId: orgId, isActive: true }, 'A/P account not found in organization');
  const payload = await buildVendorPayload(orgId, {
    ...parsed.data,
    status: parsed.data.status ?? 'ACTIVE',
  });
  const vendor = await prisma.vendor.create({
    data: { ...payload, organizationId: orgId },
    include: {
      vendorCategory: {
        select: { id: true, name: true, code: true, defaultPaymentTerms: true, defaultApAccountId: true },
      },
    },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Vendor', entityId: vendor.id, action: 'CREATE', payload });
  return ok(vendor, 201);
});
