import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateCustomerCategoryInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const cat = await prisma.customerCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!cat) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(cat));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const PUT = withPermission({ module: 'AR_CUSTOMERS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();
    const parsed = updateCustomerCategoryInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid customer category payload' }, { status: 400 }));
    }
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.prefix !== undefined) updateData.prefix = parsed.data.prefix.trim().toUpperCase();
    if (parsed.data.defaultCreditLimit !== undefined) updateData.defaultCreditLimit = parsed.data.defaultCreditLimit;
    if (parsed.data.defaultPaymentTerms !== undefined) updateData.defaultPaymentTerms = parsed.data.defaultPaymentTerms;
    if (parsed.data.defaultDiscount !== undefined) updateData.defaultDiscount = parsed.data.defaultDiscount;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description?.trim() || null;
    if (Object.keys(updateData).length === 1) {
      return withCors(NextResponse.json({ error: 'No changes provided' }, { status: 400 }));
    }
    const cat = await prisma.customerCategory.update({
      where: { id, organizationId: orgId },
      data: updateData,
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'CustomerCategory', entityId: id, action: 'UPDATE', payload: updateData });
    return withCors(NextResponse.json(cat));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AR_CUSTOMERS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.customerCategory.delete({ where: { id, organizationId: orgId } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'CustomerCategory', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
