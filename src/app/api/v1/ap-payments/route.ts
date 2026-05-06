// APPayment model: number, vendorId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, listResponse, logAudit, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler } from '@/lib/api-utils';
import { nextNumber } from '@/lib/api-utils';
import { apPaymentInputSchema } from '@/types/api';
import { resolveAccountDefaultId } from '@/lib/account-defaults';
import { postJournalEntry } from '@/lib/journal-posting';
import { toNumber } from '@/lib/money';

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
        const bill = await tx.bill.findFirst({
          where: { id: allocation.billId, organizationId: orgId },
          select: { id: true, totalAmount: true },
        });
        if (!bill) {
          throw new ApiError('Bill not found in organization', 404);
        }
        const existingAllocations = await tx.aPPaymentAllocation.aggregate({
          where: { billId: allocation.billId },
          _sum: { amountApplied: true },
        });
        const alreadyPaid = Number(existingAllocations._sum.amountApplied ?? 0);
        const outstanding = Number(bill.totalAmount) - alreadyPaid;
        if (Number(allocation.amountApplied) > outstanding + 0.01) {
          throw new ApiError(
            `Over-allocation: bill ${allocation.billId} has outstanding ${outstanding.toFixed(2)}, cannot apply ${allocation.amountApplied}`,
            422,
          );
        }
      }
    }
    const created = await tx.aPPayment.create({
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

    // Post DR AP / CR Bank for the payment amount.
    const amount = toNumber(created.totalAmount);
    if (amount > 0) {
      const accounts = await tx.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
      });
      const apAccountId =
        created.apAccountId
        ?? resolveAccountDefaultId(accounts, undefined, 'apControl');
      const bankAccountId =
        created.cashAccountId
        ?? resolveAccountDefaultId(accounts, undefined, 'bankAsset');

      if (apAccountId && bankAccountId) {
        await postJournalEntry(tx, {
          organizationId: orgId,
          date: new Date(created.date),
          memo: `AP payment: ${created.number}`,
          lines: [
            {
              accountId: apAccountId,
              description: `AP settlement - ${created.number}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: bankAccountId,
              description: `Bank disbursement - ${created.number}`,
              debit: 0,
              credit: amount,
            },
          ],
        });
      }
    }

    return created;
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'APPayment', entityId: payment.id, action: 'CREATE', payload: { number } });
  return ok(payment, 201);
});
