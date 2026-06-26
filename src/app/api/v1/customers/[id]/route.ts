import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, softDelete, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateCustomerInputSchema } from '@/types/api';

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
  // Stale category names (e.g. legacy seed values that never made it to the DB)
  // shouldn't block unrelated edits like address changes — skip the field instead
  // of 404'ing the whole request.
  if (!category) return undefined;
  return category.id;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const customer = await prisma.customer.findFirst({ where: { id, organizationId: orgId } });
    if (!customer) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(customer));
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
    const parsed = updateCustomerInputSchema.safeParse({
      ...body,
      status: typeof body.status === 'string' ? String(body.status).trim().toUpperCase() : body.status,
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid customer payload' }, { status: 400 }));
    }

    const categoryId = await resolveCustomerCategoryId(orgId, parsed.data.categoryId, parsed.data.category);
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (parsed.data.code !== undefined) updateData.code = parsed.data.code?.trim() || null;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.email !== undefined) updateData.email = parsed.data.email?.trim() || null;
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone?.trim() || null;
    if (parsed.data.website !== undefined) updateData.website = parsed.data.website?.trim() || null;
    if (parsed.data.contactPerson !== undefined) updateData.contactPerson = parsed.data.contactPerson?.trim() || null;
    if (parsed.data.billingAddress !== undefined || parsed.data.address1 !== undefined) {
      updateData.billingAddress = (parsed.data.billingAddress ?? parsed.data.address1)?.trim() || null;
    }
    if (parsed.data.shippingAddress !== undefined) updateData.shippingAddress = parsed.data.shippingAddress?.trim() || null;
    if (parsed.data.shippingSameAsBilling !== undefined) {
      updateData.shippingSameAsBilling = parsed.data.shippingSameAsBilling;
      if (parsed.data.shippingSameAsBilling && updateData.billingAddress !== undefined) {
        updateData.shippingAddress = updateData.billingAddress;
      }
    }
    if (parsed.data.city !== undefined) updateData.city = parsed.data.city?.trim() || null;
    if (parsed.data.province !== undefined) updateData.province = parsed.data.province?.trim() || null;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.taxable !== undefined) updateData.taxable = parsed.data.taxable;
    if (parsed.data.paymentTerms !== undefined || parsed.data.paymentTermsDays !== undefined) {
      updateData.paymentTermsDays = parsed.data.paymentTermsDays ?? parsed.data.paymentTerms;
    }
    if (parsed.data.defaultDiscount !== undefined) updateData.defaultDiscount = parsed.data.defaultDiscount;
    if (parsed.data.creditLimit !== undefined) updateData.creditLimit = parsed.data.creditLimit;
    if (parsed.data.openingBalance !== undefined || parsed.data.initialBalance !== undefined) {
      updateData.openingBalance = parsed.data.openingBalance ?? parsed.data.initialBalance;
    }
    if (parsed.data.useCategoryDefaults !== undefined) updateData.useCategoryDefaults = parsed.data.useCategoryDefaults;
    if (categoryId !== undefined) updateData.categoryId = categoryId;

    if (Object.keys(updateData).length === 1) {
      return withCors(NextResponse.json({ error: 'No changes provided' }, { status: 400 }));
    }

    const customer = await prisma.customer.update({
      where: { id, organizationId: orgId },
      data: updateData,
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Customer', entityId: id, action: 'UPDATE', payload: updateData });
    return withCors(NextResponse.json(customer));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AR_CUSTOMERS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const deleted = await softDelete(
      prisma.customer,
      { id, organizationId: orgId, status: { not: 'INACTIVE' } },
      { status: 'INACTIVE', updatedAt: new Date() },
    );
    if (!deleted) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Customer', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
