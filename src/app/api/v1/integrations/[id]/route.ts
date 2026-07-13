import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateIntegrationInputSchema } from '@/types/api';

export const runtime = 'nodejs';

const toMappings = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, itemId]) => {
    if (key.trim() && typeof itemId === 'string' && itemId.trim()) {
      acc[key] = itemId.trim();
    }
    return acc;
  }, {});
};

async function validateConnectionForeignKeys(
  orgId: string,
  customerId?: string | null,
  holdingAccountId?: string | null,
  salesTypeId?: string | null,
) {
  if (customerId) {
    await validateForeignKey(prisma.customer, { id: customerId, organizationId: orgId, status: 'ACTIVE' }, 'Selected customer was not found.');
  }

  if (holdingAccountId) {
    await validateForeignKey(prisma.bankAccount, { id: holdingAccountId, organizationId: orgId, isActive: true }, 'Selected settlement account was not found.');
  }

  if (salesTypeId) {
    await validateForeignKey(prisma.salesType, { id: salesTypeId, organizationId: orgId }, 'Selected sales type was not found.');
  }
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

export const GET = withPermission({ module: 'INTEGRATIONS', action: 'view' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
});

export const PUT = withPermission({ module: 'INTEGRATIONS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
    const parsed = updateIntegrationInputSchema.safeParse({
      ...body,
      ...(body.platform !== undefined && { platform: String(body.platform ?? '').trim().toUpperCase() }),
      ...(body.status !== undefined && { status: String(body.status ?? '').trim().toUpperCase() }),
      ...(body.customerId !== undefined && { customerId: typeof body.customerId === 'string' && body.customerId.trim() ? body.customerId.trim() : null }),
      ...(body.holdingAccountId !== undefined && { holdingAccountId: typeof body.holdingAccountId === 'string' && body.holdingAccountId.trim() ? body.holdingAccountId.trim() : null }),
      ...(body.itemMappings !== undefined && { itemMappings: toMappings(body.itemMappings) }),
      ...(body.mappings !== undefined && { mappings: body.mappings }),
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid integration payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const updateData: Record<string, unknown> = parsed.data;

    if (Object.keys(updateData).length === 0) {
      return withCors(NextResponse.json({ error: 'No changes provided.' }, { status: 400 }));
    }

    await validateConnectionForeignKeys(
      orgId,
      (updateData.customerId as string | null | undefined) ?? existing.customerId,
      (updateData.holdingAccountId as string | null | undefined) ?? existing.holdingAccountId,
      (updateData.salesTypeId as string | null | undefined) ?? existing.salesTypeId
    );

    const shopName = String(updateData.shopName ?? existing.shopName).trim();
    const platform = String(updateData.platform ?? existing.platform).trim().toUpperCase();
    const connection = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.ecommerceConnection.findFirst({
        where: {
          organizationId: orgId,
          id: { not: id },
          platform: platform as any,
          shopName: { equals: shopName, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ApiError('This shop already exists for the selected platform.', 409);
      }

      return tx.ecommerceConnection.update({
        where: { id },
        data: updateData,
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
      entityId: id,
      action: 'UPDATE',
      payload: updateData,
    });

    return withCors(NextResponse.json(connection));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed to update integration';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'INTEGRATIONS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
});
