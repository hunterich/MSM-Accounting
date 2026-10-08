// ARPayment model: number, customerId, date, method (PaymentMethod), totalAmount, status (PaymentStatus)
// PaymentStatus: DRAFT | PROCESSING | COMPLETED | VOID
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler, ApiError, nextNumber } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { arPaymentInputSchema } from '@/types/api';
import { postArPaymentIfNeeded } from '@/lib/payment-posting';
import { syncArPaymentSettlement } from '@/lib/settlement-status';
import { routeForApproval } from '@/lib/approval/engine';
import { normalizeArPaymentAccount } from '@/lib/ar-payment-input';

import { validatePaymentAllocations } from '@/lib/payment-validation';

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

  const search = searchParams.get('search');
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { customer: { name: { contains: search, mode: 'insensitive' } } },
    { allocations: { some: { invoice: { number: { contains: search, mode: 'insensitive' } } } } },
  ];
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  if (dateFrom || dateTo) where.date = {
    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
    ...(dateTo ? { lt: new Date(new Date(dateTo).getTime() + 86400000) } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.aRPayment.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: { customer: { select: { id: true, name: true, code: true } }, allocations: true },
    }),
    prisma.aRPayment.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'AR_PAYMENTS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);
  const body = await req.json();
  const parsed = arPaymentInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid AR payment payload', 400);
  }
  const { allocations, ...payload } = normalizeArPaymentAccount(parsed.data);
  const payment = await prisma.$transaction(async (tx) => {
    await validateForeignKey(tx.customer, { id: payload.customerId, organizationId: orgId, status: 'ACTIVE' }, 'Customer not found in organization');
    // Allocate the number INSIDE the transaction with `tx` so its advisory lock
    // stays held until the insert commits (calling it on the base `prisma`
    // client releases the lock before the insert → spurious 409s under load).
    const number = await nextNumber(tx, 'ARPayment', 'number', 'ARP');
    await validatePaymentAllocations(tx, orgId, 'ar', { ...payload, allocations });
    const created = await tx.aRPayment.create({
      data: {
        ...payload,
        // zod validates YYYY-MM-DD; Prisma DateTime needs a Date object.
        date: new Date(payload.date),
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

    // Post DR Bank / CR AR — skipped for DRAFT payments; idempotent via
    // journalEntryId (see lib/payment-posting.ts). A payment created directly
    // into COMPLETED is a finalize, so it
    // may be routed for approval first.
    const isPostable = created.status === 'COMPLETED';
    if (isPostable) {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'AR_PAYMENT',
        documentId: created.id,
      });
      if (routed) {
        // HELD for approval: stamp PENDING_APPROVAL and post NO GL.
        await tx.aRPayment.update({
          where: { id: created.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
        (created as any).status = 'PENDING_APPROVAL';
      } else {
        await postArPaymentIfNeeded(tx, orgId, created.id, dateOverride);
      }
    }
    // Roll the allocations up into the settled documents' status (PAID).
    await syncArPaymentSettlement(tx, orgId, created.id);

    return created;
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: payment.id, action: 'CREATE', payload: { number: payment.number } });
  return ok(payment, 201);
});
