// @ts-nocheck
// APPayment model: number, vendorId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, nextNumber, logAudit, validateForeignKey } from '@/lib/api-utils';
import { apPaymentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit    = Math.min(100, Number(searchParams.get('limit') ?? 20));
    const status   = searchParams.get('status');
    const vendorId = searchParams.get('vendorId');

    const where: any = { organizationId: orgId };
    if (status)   where.status   = status;
    if (vendorId) where.vendorId = vendorId;

    const [data, total] = await Promise.all([
      prisma.aPPayment.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { date: 'desc' },
        include: { vendor: { select: { id: true, name: true, code: true } } },
      }),
      prisma.aPPayment.count({ where }),
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
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    const body = await req.json();
    const parsed = apPaymentInputSchema.safeParse({
      ...body,
      organizationId: orgId,
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid AP payment payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { allocations, ...payload } = parsed.data;
    const number = await nextNumber(prisma, 'APPayment', 'number', 'APP');
    const payment = await prisma.$transaction(async (tx) => {
      await validateForeignKey(tx.vendor, { id: payload.vendorId, organizationId: orgId, status: 'ACTIVE' }, 'Vendor not found in organization');
      if (allocations?.length) {
        for (const allocation of allocations) {
          await validateForeignKey(tx.bill, { id: allocation.billId, organizationId: orgId }, 'Bill not found in organization');
        }
      }
      return tx.aPPayment.create({
        data: {
          ...payload,
          organizationId: orgId,
          number,
          allocations: allocations?.length
            ? {
                create: allocations,
              }
            : undefined,
        },
        include: { vendor: { select: { id: true, name: true, code: true } }, allocations: true },
      });
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'APPayment', entityId: payment.id, action: 'CREATE', payload: { number } });
    return withCors(NextResponse.json(payment, { status: 201 }));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed to create AP payment';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
