import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, err, ok, listResponse, logAudit, parsePaginationParams, validateForeignKey } from '@/lib/api-utils';
import { bankTransactionInputSchema } from '@/types/api';
import { postBankTransactionIfNeeded } from '@/lib/bank-transaction-posting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 100 });
  const bankAccountId = searchParams.get('bankAccountId');
  const type = searchParams.get('type');
  const where: any = { organizationId: orgId };
  if (bankAccountId) where.bankAccountId = bankAccountId;
  if (type) where.type = type;
  const [data, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      include: { bankAccount: { select: { id: true, name: true } } },
    }),
    prisma.bankTransaction.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = bankTransactionInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid bank transaction payload', 400);
  const { bankAccountId, type, amount, date, ...rest } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    await validateForeignKey(tx.bankAccount, { id: bankAccountId, organizationId: orgId, isActive: true }, 'Bank account not found in organization');
    if (rest.toBankAccountId) {
      await validateForeignKey(tx.bankAccount, { id: rest.toBankAccountId, organizationId: orgId, isActive: true }, 'Destination bank account not found in organization');
    }
    const txn = await tx.bankTransaction.create({
      data: { ...rest, bankAccountId, type, amount, date: new Date(date), organizationId: orgId },
      include: { bankAccount: { select: { id: true, name: true } } },
    });
    const delta = type === 'INCOME' ? amount : type === 'TRANSFER' ? 0 : -amount;
    if (delta !== 0) {
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: { increment: delta } },
      });
    }
    // Post Dr Expense / [Dr Input Tax] / Cr Bank for direct expenses (no-op for INCOME/TRANSFER).
    await postBankTransactionIfNeeded(tx, orgId, txn.id);
    return txn;
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankTransaction', entityId: result.id, action: 'CREATE', payload: { bankAccountId, type, amount } });
  return ok(result, 201);
});
