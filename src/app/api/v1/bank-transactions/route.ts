// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, listResponse, logAudit } from '@/lib/api-utils';

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
  const body = await req.json();
  const { bankAccountId, type, amount } = body;

  const result = await prisma.$transaction(async (tx) => {
    const txn = await tx.bankTransaction.create({
      data: { ...body, organizationId: orgId },
      include: { bankAccount: { select: { id: true, name: true } } },
    });
    // Update bank account balance: INCOME/CREDIT increases balance, EXPENSE/DEBIT decreases
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
}
