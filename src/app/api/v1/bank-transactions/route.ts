// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, ok, listResponse, logAudit, validateForeignKey } from '@/lib/api-utils';
import { bankTransactionInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(100, Number(searchParams.get('limit') ?? 50));
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
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const body = await req.json();
  const parsed = bankTransactionInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid bank transaction payload', 400);
  const { bankAccountId, type, amount, date, ...rest } = parsed.data;

  try {
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
      return txn;
    });

    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'BankTransaction', entityId: result.id, action: 'CREATE', payload: { bankAccountId, type, amount } });
    return ok(result, 201);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to create bank transaction';
    return err(message, 500);
  }
}
