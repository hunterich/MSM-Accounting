import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const TOLERANCE = 0.01;
const DAY_WINDOW = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface MatchedPair {
  paymentType: 'AR' | 'AP';
  paymentId: string;
  paymentNumber: string;
  paymentAmount: number;
  paymentDate: string;
  bankTransactionId: string;
  bankTxnDescription: string;
  bankTxnAmount: number;
  bankTxnDate: string;
  customerOrVendor: string;
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  // Fetch completed AR payments
  const arPayments = await prisma.aRPayment.findMany({
    where: { organizationId: orgId, status: 'COMPLETED' },
    include: { customer: { select: { name: true } } },
  });

  // Fetch completed AP payments
  const apPayments = await prisma.aPPayment.findMany({
    where: { organizationId: orgId, status: 'COMPLETED' },
    include: { vendor: { select: { name: true } } },
  });

  // Fetch all bank transactions
  const bankTransactions = await prisma.bankTransaction.findMany({
    where: {
      bankAccount: { organizationId: orgId },
    },
    include: { bankAccount: { select: { name: true } } },
  });

  const matched: MatchedPair[] = [];
  const matchedBankTxIds = new Set<string>();
  const matchedPaymentIds = new Set<string>();

  // Auto-match AR payments (credits in bank)
  for (const payment of arPayments) {
    const paymentAmount = Math.abs(Number(payment.totalAmount));
    const paymentDate = new Date(payment.date);

    for (const tx of bankTransactions) {
      if (matchedBankTxIds.has(tx.id)) continue;
      const txAmount = Math.abs(Number(tx.amount));
      const txDate = new Date(tx.date);
      const daysDiff = Math.abs((txDate.getTime() - paymentDate.getTime()) / MS_PER_DAY);

      if (Math.abs(txAmount - paymentAmount) <= TOLERANCE && daysDiff <= DAY_WINDOW && tx.type === 'INCOME') {
        matched.push({
          paymentType: 'AR',
          paymentId: payment.id,
          paymentNumber: payment.number,
          paymentAmount,
          paymentDate: payment.date.toISOString().slice(0, 10),
          bankTransactionId: tx.id,
          bankTxnDescription: tx.description,
          bankTxnAmount: txAmount,
          bankTxnDate: tx.date.toISOString().slice(0, 10),
          customerOrVendor: (payment as any).customer?.name || '',
        });
        matchedBankTxIds.add(tx.id);
        matchedPaymentIds.add(`AR:${payment.id}`);
        break;
      }
    }
  }

  // Auto-match AP payments (debits in bank)
  for (const payment of apPayments) {
    const paymentAmount = Math.abs(Number(payment.totalAmount));
    const paymentDate = new Date(payment.date);

    for (const tx of bankTransactions) {
      if (matchedBankTxIds.has(tx.id)) continue;
      const txAmount = Math.abs(Number(tx.amount));
      const txDate = new Date(tx.date);
      const daysDiff = Math.abs((txDate.getTime() - paymentDate.getTime()) / MS_PER_DAY);

      if (Math.abs(txAmount - paymentAmount) <= TOLERANCE && daysDiff <= DAY_WINDOW && tx.type === 'EXPENSE') {
        matched.push({
          paymentType: 'AP',
          paymentId: payment.id,
          paymentNumber: payment.number,
          paymentAmount,
          paymentDate: payment.date.toISOString().slice(0, 10),
          bankTransactionId: tx.id,
          bankTxnDescription: tx.description,
          bankTxnAmount: txAmount,
          bankTxnDate: tx.date.toISOString().slice(0, 10),
          customerOrVendor: (payment as any).vendor?.name || '',
        });
        matchedBankTxIds.add(tx.id);
        matchedPaymentIds.add(`AP:${payment.id}`);
        break;
      }
    }
  }

  const unmatchedPayments = [
    ...arPayments
      .filter((p) => !matchedPaymentIds.has(`AR:${p.id}`))
      .map((p) => ({
        type: 'AR' as const,
        id: p.id,
        number: p.number,
        amount: Number(p.totalAmount),
        date: p.date.toISOString().slice(0, 10),
        customerOrVendor: (p as any).customer?.name || '',
      })),
    ...apPayments
      .filter((p) => !matchedPaymentIds.has(`AP:${p.id}`))
      .map((p) => ({
        type: 'AP' as const,
        id: p.id,
        number: p.number,
        amount: Number(p.totalAmount),
        date: p.date.toISOString().slice(0, 10),
        customerOrVendor: (p as any).vendor?.name || '',
      })),
  ];

  const unmatchedBankTx = bankTransactions
    .filter((tx) => !matchedBankTxIds.has(tx.id))
    .map((tx) => ({
      id: tx.id,
      description: tx.description,
      amount: Number(tx.amount),
      date: tx.date.toISOString().slice(0, 10),
      type: tx.type,
      bankAccount: (tx as any).bankAccount?.name || '',
    }));

  const totalPayments = arPayments.length + apPayments.length;
  const totalMatched = matched.length;
  const matchRate = totalPayments > 0 ? Math.round((totalMatched / totalPayments) * 100) : 0;

  return ok({
    matched,
    unmatchedPayments,
    unmatchedBankTx,
    summary: {
      totalMatched,
      totalUnmatched: unmatchedPayments.length,
      totalUnmatchedBankTx: unmatchedBankTx.length,
      matchRate,
    },
  });
});
