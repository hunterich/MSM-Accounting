import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, listResponse, logAudit, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { integrationInputSchema } from '@/types/api';

export const runtime = 'nodejs';

const VALID_PLATFORMS = new Set(['SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'LAZADA', 'OTHER']);
const VALID_STATUSES = new Set(['ACTIVE', 'SYNCING', 'INACTIVE']);

const toMappings = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, itemId]) => {
    if (key.trim() && typeof itemId === 'string' && itemId.trim()) {
      acc[key] = itemId.trim();
    }
    return acc;
  }, {});
};

async function validateConnectionForeignKeys(orgId: string, customerId?: string | null, holdingAccountId?: string | null) {
  if (customerId) {
    await validateForeignKey(prisma.customer, { id: customerId, organizationId: orgId, status: 'ACTIVE' }, 'Selected customer was not found.');
  }

  if (holdingAccountId) {
    await validateForeignKey(prisma.bankAccount, { id: holdingAccountId, organizationId: orgId, isActive: true }, 'Selected settlement account was not found.');
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'INTEGRATIONS', action: 'view' }, async (req: NextRequest) => {
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
});

export const POST = withPermission({ module: 'INTEGRATIONS', action: 'create' }, async (req: NextRequest) => {
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const body = await req.json();
    const parsed = integrationInputSchema.safeParse({
      ...body,
      organizationId: orgId,
      platform: String(body.platform ?? '').trim().toUpperCase(),
      status: String(body.status ?? 'ACTIVE').trim().toUpperCase(),
      customerId: typeof body.customerId === 'string' && body.customerId.trim() ? body.customerId.trim() : null,
      holdingAccountId: typeof body.holdingAccountId === 'string' && body.holdingAccountId.trim() ? body.holdingAccountId.trim() : null,
      itemMappings: toMappings(body.itemMappings),
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid integration payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { shopName, platform, status, importStatusFilter, customerId, holdingAccountId, itemMappings, mappings } = parsed.data;

    await validateConnectionForeignKeys(orgId, customerId, holdingAccountId);

    const connection = await prisma.$transaction(async (tx) => {
      const existing = await tx.ecommerceConnection.findFirst({
        where: {
          organizationId: orgId,
          platform: platform as any,
          shopName: { equals: shopName, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (existing) {
        throw new ApiError('This shop already exists for the selected platform.', 409);
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
        mappings: mappings ? (mappings as Prisma.InputJsonValue) : Prisma.JsonNull,
      };

      return tx.ecommerceConnection.create({
        data,
        include: {
          customer: { select: { id: true, name: true } },
          holdingAccount: { select: { id: true, name: true } },
        },
      });
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
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed to create integration';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
