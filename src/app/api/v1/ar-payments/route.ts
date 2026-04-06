// @ts-nocheck
// ARPayment model: number, customerId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, nextNumber, logAudit, validateForeignKey } from '@/lib/api-utils';
import { arPaymentInputSchema } from '@/types/api';

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
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const body = await req.json();
    const parsed = arPaymentInputSchema.safeParse({
      ...body,
      organizationId: orgId,
    });
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid AR payment payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { allocations, ...payload } = parsed.data;
    const number = await nextNumber(prisma, 'ARPayment', 'number', 'ARP');
    const payment = await prisma.$transaction(async (tx) => {
      await validateForeignKey(tx.customer, { id: payload.customerId, organizationId: orgId, status: 'ACTIVE' }, 'Customer not found in organization');
      if (allocations?.length) {
        for (const allocation of allocations) {
          await validateForeignKey(tx.salesInvoice, { id: allocation.invoiceId, organizationId: orgId }, 'Invoice not found in organization');
        }
      }
      return tx.aRPayment.create({
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
        include: { customer: { select: { id: true, name: true, code: true } }, allocations: true },
      });
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: payment.id, action: 'CREATE', payload: { number } });
    return withCors(NextResponse.json(payment, { status: 201 }));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed to create AR payment';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
