import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { bankCashJournal, recordedBankCashAmount } from '@/lib/bank-amounts';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'BANKING', action: 'edit' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const { paymentType, paymentId, bankTransactionId } = body;

  if (!paymentType || !paymentId || !bankTransactionId) {
    return err('paymentType, paymentId, and bankTransactionId are required', 400);
  }

  if (paymentType !== 'AR' && paymentType !== 'AP') {
    return err('paymentType must be AR or AP', 400);
  }

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${bankTransactionId} AND "organizationId" = ${orgId} FOR UPDATE`;
    const bankTx = await tx.bankTransaction.findFirst({
      where: { id: bankTransactionId, organizationId: orgId }, include: { journalEntry: bankCashJournal },
    });
    if (!bankTx) throw new ApiError('Bank transaction not found', 404);
    const where = { id: paymentId, organizationId: orgId, status: 'COMPLETED' as const };
    const select = { totalAmount: true } as const;
    const payment = paymentType === 'AR'
      ? await tx.aRPayment.findFirst({ where, select })
      : await tx.aPPayment.findFirst({ where, select });
    if (!payment) throw new ApiError(`Completed ${paymentType} payment not found`, 404);
    const expectedType = paymentType === 'AR' ? 'INCOME' : 'EXPENSE';
    if (bankTx.type !== expectedType || !recordedBankCashAmount(bankTx)?.eq(payment.totalAmount)) {
      throw new ApiError('The bank cash amount or direction does not match this payment.', 422);
    }
    await tx.bankTransaction.update({
      where: { id: bankTransactionId, organizationId: orgId },
      data: { reference: `${paymentType}-MATCH:${paymentId}`, status: 'MATCHED' },
    });
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
