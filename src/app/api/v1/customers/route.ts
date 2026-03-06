// @ts-nocheck
// Customer model: code (required), name, email, phone, status (PartnerStatus: ACTIVE|INACTIVE)
// Unique: @@unique([organizationId, code])
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';

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
      prisma.customer.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list customers';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const customer = await prisma.customer.create({
      data: { ...body, organizationId: orgId },
    });
    return withCors(NextResponse.json(customer, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create customer';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
