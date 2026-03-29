// @ts-nocheck
// Vendor model: code (required), name, category, email, phone, status (PartnerStatus)
// Unique: @@unique([organizationId, code])
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

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
      const category = await prisma.vendorCategory.findFirst({
        where: { id: body.categoryId, organizationId: orgId },
      });
      if (!category) {
        throw new Error('Vendor category not found');
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

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(100, Number(searchParams.get('limit') ?? 50));
    const search = searchParams.get('search');
    const status = searchParams.get('status'); // ACTIVE | INACTIVE
    const categoryId = searchParams.get('categoryId');

    const where: any = { organizationId: orgId };
    if (status) where.status = status;
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

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list vendors';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const payload = await buildVendorPayload(orgId, body);
    const vendor = await prisma.vendor.create({
      data: { ...payload, organizationId: orgId },
      include: {
        vendorCategory: {
          select: { id: true, name: true, code: true, defaultPaymentTerms: true, defaultApAccountId: true },
        },
      },
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Vendor', entityId: vendor.id, action: 'CREATE', payload });
    return withCors(NextResponse.json(vendor, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create vendor';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
