import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, softDelete, validateForeignKey } from '@/lib/api-utils';
import { updateVendorCategoryInputSchema } from '@/types/api';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const category = await prisma.vendorCategory.findFirst({
      where: { id, organizationId: orgId },
      include: { _count: { select: { vendors: true } } },
    });
    if (!category) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(category));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const PUT = withPermission({ module: 'AP_VENDORS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();
    const parsed = updateVendorCategoryInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid vendor category payload' }, { status: 400 }));
    }
    if (parsed.data.defaultApAccountId) {
      await validateForeignKey(prisma.account, { id: parsed.data.defaultApAccountId, organizationId: orgId, isActive: true }, 'A/P account not found in organization');
    }
    const category = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendorCategory.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) return null;

      const nextName = parsed.data.name;
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.code !== undefined) updateData.code = parsed.data.code.trim().toUpperCase();
      if (parsed.data.defaultPaymentTerms !== undefined) updateData.defaultPaymentTerms = parsed.data.defaultPaymentTerms?.trim() || null;
      if (parsed.data.defaultApAccountId !== undefined) updateData.defaultApAccountId = parsed.data.defaultApAccountId || null;
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description?.trim() || null;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
      if (Object.keys(updateData).length === 1) {
        throw new ApiError('No changes provided', 400);
      }

      const updated = await tx.vendorCategory.update({
        where: { id },
        data: updateData,
      });

      if (nextName !== undefined) {
        await tx.vendor.updateMany({
          where: { organizationId: orgId, categoryId: id },
          data: { category: nextName || null },
        });
      }

      return updated;
    });

    if (!category) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'VendorCategory',
      entityId: id,
      action: 'UPDATE',
      payload: parsed.data,
    });
    return withCors(NextResponse.json(category));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AP_VENDORS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendorCategory.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) return null;

      await tx.vendor.updateMany({
        where: { organizationId: orgId, categoryId: id },
        data: { categoryId: null, category: null },
      });
      await tx.vendorCategory.updateMany({
        where: { id, organizationId: orgId, isActive: true },
        data: { isActive: false, updatedAt: new Date() },
      });
      return existing;
    });

    if (!deleted) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'VendorCategory',
      entityId: id,
      action: 'DELETE',
      payload: null,
    });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
