// @ts-nocheck
// Vendor model: code (required), name, category, email, phone, status (PartnerStatus)
// Unique: @@unique([organizationId, code])
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
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(100, Number(searchParams.get('limit') ?? 50));
    const search = searchParams.get('search');
    const status = searchParams.get('status'); // ACTIVE | INACTIVE

    const where: any = { organizationId: orgId };
    if (status) where.status = status;
    if (search) where.OR = [
      { name:  { contains: search, mode: 'insensitive' } },
      { code:  { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];

    const [data, total] = await Promise.all([
      prisma.vendor.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.vendor.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list vendors';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const vendor = await prisma.vendor.create({
      data: { ...body, organizationId: orgId },
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Vendor', entityId: vendor.id, action: 'CREATE', payload: null });
    return withCors(NextResponse.json(vendor, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create vendor';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
