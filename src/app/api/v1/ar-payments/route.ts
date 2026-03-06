// @ts-nocheck
// ARPayment model: number, customerId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { nextNumber } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const { searchParams } = new URL(req.url);
    const page       = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit      = Math.min(100, Number(searchParams.get('limit') ?? 20));
    const status     = searchParams.get('status');
    const customerId = searchParams.get('customerId');

    const where: any = { organizationId: orgId };
    if (status)     where.status     = status;
    if (customerId) where.customerId = customerId;

    const [data, total] = await Promise.all([
      prisma.aRPayment.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { date: 'desc' },
        include: { customer: { select: { id: true, name: true, code: true } } },
      }),
      prisma.aRPayment.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const number = await nextNumber(prisma, 'ARPayment', 'number', 'ARP');
    const payment = await prisma.aRPayment.create({
      data: { ...body, organizationId: orgId, number },
      include: { customer: { select: { id: true, name: true, code: true } } },
    });
    return withCors(NextResponse.json(payment, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create AR payment';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
