// @ts-nocheck
// Customer model: code (required), name, email, phone, status (PartnerStatus: ACTIVE|INACTIVE)
// Unique: @@unique([organizationId, code])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, ok, parsePaginationParams, validateForeignKey, withHandler } from '@/lib/api-utils';
import { createCustomerInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

async function resolveCustomerCategoryId(orgId: string, categoryId?: string | null, categoryName?: string | null) {
  if (categoryId !== undefined) {
    if (!categoryId) return null;
    await validateForeignKey(
      prisma.customerCategory,
      { id: categoryId, organizationId: orgId },
      'Customer category not found in organization',
    );
    return categoryId;
  }

  if (categoryName === undefined) return undefined;
  if (!categoryName) return null;

  const category = await prisma.customerCategory.findFirst({
    where: { organizationId: orgId, name: categoryName },
    select: { id: true },
  });
  // A stale category name (legacy seed value that never made it to the DB)
  // shouldn't block create — fall through with no category set.
  if (!category) return null;
  return category.id;
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');
  const status = searchParams.get('status'); // ACTIVE | INACTIVE

  const where: any = { organizationId: orgId };
  where.status = status || 'ACTIVE';
  if (search) where.OR = [
    { name:  { contains: search, mode: 'insensitive' } },
    { code:  { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];

  const [data, total] = await Promise.all([
    prisma.customer.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.customer.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const parsed = createCustomerInputSchema.safeParse({
    ...body,
    status: typeof body.status === 'string' ? String(body.status).trim().toUpperCase() : body.status,
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid customer payload', 400);

  const categoryId = await resolveCustomerCategoryId(orgId, parsed.data.categoryId, parsed.data.category);
  const customerData: Record<string, unknown> = {
    organizationId: orgId,
    code: parsed.data.code?.trim() || parsed.data.id?.trim(),
    name: parsed.data.name,
    status: parsed.data.status ?? 'ACTIVE',
  };

  if (parsed.data.email !== undefined) customerData.email = parsed.data.email?.trim() || null;
  if (parsed.data.phone !== undefined) customerData.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.website !== undefined) customerData.website = parsed.data.website?.trim() || null;
  if (parsed.data.contactPerson !== undefined) customerData.contactPerson = parsed.data.contactPerson?.trim() || null;
  if (parsed.data.billingAddress !== undefined || parsed.data.address1 !== undefined) {
    customerData.billingAddress = (parsed.data.billingAddress ?? parsed.data.address1)?.trim() || null;
  }
  if (parsed.data.shippingAddress !== undefined) customerData.shippingAddress = parsed.data.shippingAddress?.trim() || null;
  if (parsed.data.shippingSameAsBilling !== undefined) {
    customerData.shippingSameAsBilling = parsed.data.shippingSameAsBilling;
    // When shipping mirrors billing, keep the stored shipping address in sync so
    // documents that default from shippingAddress get the right value.
    if (parsed.data.shippingSameAsBilling) {
      customerData.shippingAddress = (customerData.billingAddress as string | null) ?? null;
    }
  }
  if (parsed.data.city !== undefined) customerData.city = parsed.data.city?.trim() || null;
  if (parsed.data.province !== undefined) customerData.province = parsed.data.province?.trim() || null;
  if (parsed.data.taxable !== undefined) customerData.taxable = parsed.data.taxable;
  if (parsed.data.paymentTerms !== undefined || parsed.data.paymentTermsDays !== undefined) {
    customerData.paymentTermsDays = parsed.data.paymentTermsDays ?? parsed.data.paymentTerms;
  }
  if (parsed.data.defaultDiscount !== undefined) customerData.defaultDiscount = parsed.data.defaultDiscount;
  if (parsed.data.creditLimit !== undefined) customerData.creditLimit = parsed.data.creditLimit;
  if (parsed.data.openingBalance !== undefined || parsed.data.initialBalance !== undefined) {
    customerData.openingBalance = parsed.data.openingBalance ?? parsed.data.initialBalance;
  }
  if (parsed.data.useCategoryDefaults !== undefined) customerData.useCategoryDefaults = parsed.data.useCategoryDefaults;
  if (categoryId !== undefined) customerData.categoryId = categoryId;

  const customer = await prisma.customer.create({
    data: customerData,
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Customer', entityId: customer.id, action: 'CREATE', payload: null });
  return ok(customer, 201);
});
