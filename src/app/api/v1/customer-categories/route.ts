// @ts-nocheck
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
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');

    const where: any = { organizationId: orgId };
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const data = await prisma.customerCategory.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { customers: true } } },
    });

    return withCors(NextResponse.json(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list customer categories';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const category = await prisma.customerCategory.create({
      data: { ...body, organizationId: orgId },
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'CustomerCategory', entityId: category.id, action: 'CREATE', payload: { name: category.name } });
    return withCors(NextResponse.json(category, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create category';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
