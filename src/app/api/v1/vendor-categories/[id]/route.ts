import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const existing = await prisma.vendorCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    const body = await req.json();
    const category = await prisma.vendorCategory.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.code !== undefined && { code: String(body.code).toUpperCase() }),
        ...(body.defaultPaymentTerms !== undefined && { defaultPaymentTerms: body.defaultPaymentTerms || null }),
        ...(body.defaultApAccountId !== undefined && { defaultApAccountId: body.defaultApAccountId || null }),
        ...(body.description !== undefined && { description: body.description || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: new Date(),
      },
    });

    if (body.name !== undefined) {
      await prisma.vendor.updateMany({
        where: { organizationId: orgId, categoryId: id },
        data: { category: body.name || null },
      });
    }

    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'VendorCategory',
      entityId: id,
      action: 'UPDATE',
      payload: body,
    });
    return withCors(NextResponse.json(category));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const existing = await prisma.vendorCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    await prisma.vendor.updateMany({
      where: { organizationId: orgId, categoryId: id },
      data: { categoryId: null, category: null },
    });
    await prisma.vendorCategory.delete({ where: { id } });

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
}
