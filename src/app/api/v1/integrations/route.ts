import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { listResponse, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

const VALID_PLATFORMS = new Set(['SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'LAZADA', 'OTHER']);
const VALID_STATUSES = new Set(['ACTIVE', 'SYNCING', 'INACTIVE']);
const VALID_IMPORT_FILTERS = new Set(['Selesai', 'All']);

const toMappings = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, itemId]) => {
    if (key.trim() && typeof itemId === 'string' && itemId.trim()) {
      acc[key] = itemId.trim();
    }
    return acc;
  }, {});
};

async function validateForeignKeys(orgId: string, customerId?: string | null, holdingAccountId?: string | null) {
  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      select: { id: true },
    });
    if (!customer) return 'Selected customer was not found.';
  }

  if (holdingAccountId) {
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: holdingAccountId, organizationId: orgId },
      select: { id: true },
    });
    if (!bankAccount) return 'Selected settlement account was not found.';
  }

  return null;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit = Math.min(100, Number(searchParams.get('limit') ?? 50));
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status')?.trim();
    const platform = searchParams.get('platform')?.trim();

    const where: Prisma.EcommerceConnectionWhereInput = { organizationId: orgId };

    if (search) {
      where.OR = [
        { shopName: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status && VALID_STATUSES.has(status)) {
      where.status = status as Prisma.EnumConnectionStatusFilter['equals'];
    }

    if (platform && VALID_PLATFORMS.has(platform)) {
      where.platform = platform as Prisma.EnumEcommercePlatformFilter['equals'];
    }

    const [data, total] = await Promise.all([
      prisma.ecommerceConnection.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { shopName: 'asc' },
        include: {
          customer: { select: { id: true, name: true } },
          holdingAccount: { select: { id: true, name: true } },
        },
      }),
      prisma.ecommerceConnection.count({ where }),
    ]);

    return listResponse(data, total, page, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list integrations';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const body = await req.json();
    const shopName = String(body.shopName ?? '').trim();
    const platform = String(body.platform ?? '').trim().toUpperCase();
    const status = String(body.status ?? 'ACTIVE').trim().toUpperCase();
    const importStatusFilter = body.importStatusFilter === 'All' ? 'All' : 'Selesai';
    const customerId = typeof body.customerId === 'string' && body.customerId.trim() ? body.customerId.trim() : null;
    const holdingAccountId = typeof body.holdingAccountId === 'string' && body.holdingAccountId.trim() ? body.holdingAccountId.trim() : null;
    const itemMappings = toMappings(body.itemMappings);

    if (!shopName) {
      return withCors(NextResponse.json({ error: 'Shop name is required.' }, { status: 400 }));
    }

    if (!VALID_PLATFORMS.has(platform)) {
      return withCors(NextResponse.json({ error: 'Invalid platform.' }, { status: 400 }));
    }

    if (!VALID_STATUSES.has(status)) {
      return withCors(NextResponse.json({ error: 'Invalid connection status.' }, { status: 400 }));
    }

    if (!VALID_IMPORT_FILTERS.has(importStatusFilter)) {
      return withCors(NextResponse.json({ error: 'Invalid import status filter.' }, { status: 400 }));
    }

    const foreignKeyError = await validateForeignKeys(orgId, customerId, holdingAccountId);
    if (foreignKeyError) {
      return withCors(NextResponse.json({ error: foreignKeyError }, { status: 400 }));
    }

    const existing = await prisma.ecommerceConnection.findFirst({
      where: {
        organizationId: orgId,
        platform: platform as any,
        shopName: { equals: shopName, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existing) {
      return withCors(NextResponse.json({ error: 'This shop already exists for the selected platform.' }, { status: 409 }));
    }

    const data: Prisma.EcommerceConnectionUncheckedCreateInput = {
      organizationId: orgId,
      platform: platform as any,
      shopName,
      customerId,
      holdingAccountId,
      status: status as any,
      importStatusFilter,
      itemMappings,
    };

    const connection = await prisma.ecommerceConnection.create({
      data,
      include: {
        customer: { select: { id: true, name: true } },
        holdingAccount: { select: { id: true, name: true } },
      },
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'EcommerceConnection',
      entityId: connection.id,
      action: 'CREATE',
      payload: {
        platform,
        shopName,
        customerId,
        holdingAccountId,
        importStatusFilter,
      },
    });

    return withCors(NextResponse.json(connection, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create integration';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
