import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { vendorCategoryInputSchema } from '@/types/api';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const isActive = searchParams.get('isActive');

    const where: any = { organizationId: orgId, isActive: isActive ? isActive === 'true' : true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const categories = await prisma.vendorCategory.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { vendors: true } } },
    });

    return withCors(NextResponse.json(categories));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list vendor categories';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const POST = withPermission({ module: 'AP_VENDORS', action: 'create' }, async (req: NextRequest) => {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    const body = await req.json();
    const parsed = vendorCategoryInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid vendor category payload' }, { status: 400 }));
    }
    if (parsed.data.defaultApAccountId) {
      await validateForeignKey(prisma.account, { id: parsed.data.defaultApAccountId, organizationId: orgId, isActive: true }, 'A/P account not found in organization');
    }
    const category = await prisma.vendorCategory.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        code: parsed.data.code.trim().toUpperCase(),
        defaultPaymentTerms: parsed.data.defaultPaymentTerms?.trim() || null,
        defaultApAccountId: parsed.data.defaultApAccountId || null,
        description: parsed.data.description?.trim() || null,
        isActive: parsed.data.isActive,
      },
    });
    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'VendorCategory',
      entityId: category.id,
      action: 'CREATE',
      payload: { name: category.name, code: category.code },
    });
    return withCors(NextResponse.json(category, { status: 201 }));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed to create vendor category';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
