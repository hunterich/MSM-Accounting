// ARPayment model: number, customerId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler, ApiError, nextNumber } from '@/lib/api-utils';
import { arPaymentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
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

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = arPaymentInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid AR payment payload', 400);
  }
  const { allocations, ...payload } = parsed.data;
  const number = await nextNumber(prisma, 'ARPayment', 'number', 'ARP');
  const payment = await prisma.$transaction(async (tx) => {
    await validateForeignKey(tx.customer, { id: payload.customerId, organizationId: orgId, status: 'ACTIVE' }, 'Customer not found in organization');
    if (allocations?.length) {
      for (const allocation of allocations) {
        const invoice = await tx.salesInvoice.findFirst({
          where: { id: allocation.invoiceId, organizationId: orgId },
          select: { id: true, totalAmount: true },
        });
        if (!invoice) {
          throw new ApiError('Invoice not found in organization', 404);
        }
        const existingAllocations = await tx.aRPaymentAllocation.aggregate({
          where: { invoiceId: allocation.invoiceId },
          _sum: { amountApplied: true },
        });
        const alreadyPaid = Number(existingAllocations._sum.amountApplied ?? 0);
        const outstanding = Number(invoice.totalAmount) - alreadyPaid;
        if (Number(allocation.amountApplied) > outstanding + 0.01) {
          throw new ApiError(
            `Over-allocation: invoice ${allocation.invoiceId} has outstanding ${outstanding.toFixed(2)}, cannot apply ${allocation.amountApplied}`,
            422,
          );
        }
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
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: payment.id, action: 'CREATE', payload: { number } });
  return ok(payment, 201);
});
