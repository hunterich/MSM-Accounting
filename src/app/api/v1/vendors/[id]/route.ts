import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

async function buildVendorPayload(orgId: string, body: any) {
  const payload: any = {
    ...(body.code !== undefined && { code: body.code }),
    ...(body.name !== undefined && { name: body.name }),
    ...(body.email !== undefined && { email: body.email || null }),
    ...(body.phone !== undefined && { phone: body.phone || null }),
    ...(body.paymentTerms !== undefined && { paymentTerms: body.paymentTerms || null }),
    ...(body.npwp !== undefined && { npwp: body.npwp || null }),
    ...(body.status !== undefined && { status: body.status }),
    ...(body.defaultApAccountId !== undefined && { defaultApAccountId: body.defaultApAccountId || null }),
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
      if (body.paymentTerms === undefined && category.defaultPaymentTerms) {
        payload.paymentTerms = category.defaultPaymentTerms;
      }
      if (body.defaultApAccountId === undefined && category.defaultApAccountId) {
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id, organizationId: orgId },
      include: {
        vendorCategory: {
          select: { id: true, name: true, code: true, defaultPaymentTerms: true, defaultApAccountId: true },
        },
      },
    });
    if (!vendor) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(vendor));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();
    const payload = await buildVendorPayload(orgId, body);
    const vendor = await prisma.vendor.update({
      where: { id, organizationId: orgId },
      data: { ...payload, updatedAt: new Date() },
      include: {
        vendorCategory: {
          select: { id: true, name: true, code: true, defaultPaymentTerms: true, defaultApAccountId: true },
        },
      },
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Vendor', entityId: id, action: 'UPDATE', payload });
    return withCors(NextResponse.json(vendor));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.vendor.delete({ where: { id, organizationId: orgId } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Vendor', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
