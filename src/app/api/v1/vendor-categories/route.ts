import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

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

    const where: any = { organizationId: orgId };
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

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    const body = await req.json();
    const category = await prisma.vendorCategory.create({
      data: {
        organizationId: orgId,
        name: body.name,
        code: String(body.code || '').toUpperCase(),
        defaultPaymentTerms: body.defaultPaymentTerms || null,
        defaultApAccountId: body.defaultApAccountId || null,
        description: body.description || null,
        isActive: body.isActive !== false,
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
    const message = error instanceof Error ? error.message : 'Failed to create vendor category';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
