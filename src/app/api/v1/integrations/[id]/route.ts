import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

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

async function findOwnedConnection(id: string, orgId: string) {
  return prisma.ecommerceConnection.findFirst({
    where: { id, organizationId: orgId },
    include: {
      customer: { select: { id: true, name: true } },
      holdingAccount: { select: { id: true, name: true } },
    },
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { id } = await params;
    const connection = await findOwnedConnection(id, orgId);

    if (!connection) {
      return withCors(NextResponse.json({ error: 'Integration not found.' }, { status: 404 }));
    }

    return withCors(NextResponse.json(connection));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load integration';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { id } = await params;
    const existing = await findOwnedConnection(id, orgId);

    if (!existing) {
      return withCors(NextResponse.json({ error: 'Integration not found.' }, { status: 404 }));
    }

    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body.shopName !== undefined) {
      const shopName = String(body.shopName ?? '').trim();
      if (!shopName) {
        return withCors(NextResponse.json({ error: 'Shop name is required.' }, { status: 400 }));
      }
      updateData.shopName = shopName;
    }

    if (body.platform !== undefined) {
      const platform = String(body.platform ?? '').trim().toUpperCase();
      if (!VALID_PLATFORMS.has(platform)) {
        return withCors(NextResponse.json({ error: 'Invalid platform.' }, { status: 400 }));
      }
      updateData.platform = platform;
    }

    if (body.status !== undefined) {
      const status = String(body.status ?? '').trim().toUpperCase();
      if (!VALID_STATUSES.has(status)) {
        return withCors(NextResponse.json({ error: 'Invalid connection status.' }, { status: 400 }));
      }
      updateData.status = status;
    }

    if (body.importStatusFilter !== undefined) {
      if (!VALID_IMPORT_FILTERS.has(String(body.importStatusFilter))) {
        return withCors(NextResponse.json({ error: 'Invalid import status filter.' }, { status: 400 }));
      }
      updateData.importStatusFilter = body.importStatusFilter;
    }

    if (body.customerId !== undefined) {
      updateData.customerId = typeof body.customerId === 'string' && body.customerId.trim()
        ? body.customerId.trim()
        : null;
    }

    if (body.holdingAccountId !== undefined) {
      updateData.holdingAccountId = typeof body.holdingAccountId === 'string' && body.holdingAccountId.trim()
        ? body.holdingAccountId.trim()
        : null;
    }

    if (body.itemMappings !== undefined) {
      updateData.itemMappings = toMappings(body.itemMappings);
    }

    if (Object.keys(updateData).length === 0) {
      return withCors(NextResponse.json({ error: 'No changes provided.' }, { status: 400 }));
    }

    const foreignKeyError = await validateForeignKeys(
      orgId,
      (updateData.customerId as string | null | undefined) ?? existing.customerId,
      (updateData.holdingAccountId as string | null | undefined) ?? existing.holdingAccountId
    );
    if (foreignKeyError) {
      return withCors(NextResponse.json({ error: foreignKeyError }, { status: 400 }));
    }

    const shopName = String(updateData.shopName ?? existing.shopName).trim();
    const platform = String(updateData.platform ?? existing.platform).trim().toUpperCase();
    const duplicate = await prisma.ecommerceConnection.findFirst({
      where: {
        organizationId: orgId,
        id: { not: id },
        platform: platform as any,
        shopName: { equals: shopName, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (duplicate) {
      return withCors(NextResponse.json({ error: 'This shop already exists for the selected platform.' }, { status: 409 }));
    }

    const connection = await prisma.ecommerceConnection.update({
      where: { id },
      data: updateData,
      include: {
        customer: { select: { id: true, name: true } },
        holdingAccount: { select: { id: true, name: true } },
      },
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'EcommerceConnection',
      entityId: id,
      action: 'UPDATE',
      payload: updateData,
    });

    return withCors(NextResponse.json(connection));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update integration';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { id } = await params;
    const existing = await findOwnedConnection(id, orgId);

    if (!existing) {
      return withCors(NextResponse.json({ error: 'Integration not found.' }, { status: 404 }));
    }

    await prisma.ecommerceConnection.deleteMany({ where: { id, organizationId: orgId } });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'EcommerceConnection',
      entityId: id,
      action: 'DELETE',
      payload: {
        platform: existing.platform,
        shopName: existing.shopName,
      },
    });

    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete integration';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
