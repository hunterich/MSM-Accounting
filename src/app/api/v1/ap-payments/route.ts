// APPayment model: number, vendorId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, listResponse, logAudit, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler } from '@/lib/api-utils';
import { nextNumber } from '@/lib/api-utils';
import { apPaymentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
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

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = apPaymentInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid AP payment payload', 400);
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
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'APPayment', entityId: payment.id, action: 'CREATE', payload: { number } });
  return ok(payment, 201);
});
