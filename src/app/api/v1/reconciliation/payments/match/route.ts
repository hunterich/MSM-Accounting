import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const { paymentType, paymentId, bankTransactionId } = body;

  if (!paymentType || !paymentId || !bankTransactionId) {
    return err('paymentType, paymentId, and bankTransactionId are required', 400);
  }

  if (paymentType !== 'AR' && paymentType !== 'AP') {
    return err('paymentType must be AR or AP', 400);
  }

  // Verify payment exists
  if (paymentType === 'AR') {
    const payment = await prisma.aRPayment.findFirst({
      where: { id: paymentId, organizationId: orgId },
    });
    if (!payment) throw new ApiError('AR payment not found', 404);
  } else {
    const payment = await prisma.aPPayment.findFirst({
      where: { id: paymentId, organizationId: orgId },
    });
    if (!payment) throw new ApiError('AP payment not found', 404);
  }

  // Verify bank transaction exists
  const bankTx = await prisma.bankTransaction.findFirst({
    where: {
      id: bankTransactionId,
      bankAccount: { organizationId: orgId },
    },
  });
  if (!bankTx) throw new ApiError('Bank transaction not found', 404);

  // Update bank transaction with reference to the payment
  await prisma.bankTransaction.update({
    where: { id: bankTransactionId },
    data: {
      reference: `${paymentType}-MATCH:${paymentId}`,
      status: 'MATCHED',
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'PaymentReconciliation',
    entityId: bankTransactionId,
    action: 'UPDATE',
    payload: { paymentType, paymentId, bankTransactionId },
  });

  return ok({ matched: true, paymentType, paymentId, bankTransactionId });
});
