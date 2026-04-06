import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, logAudit, validateForeignKey } from '@/lib/api-utils';
import { updateBankTransactionInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const txn = await prisma.bankTransaction.findFirst({
    where: { id, organizationId: orgId },
    include: { bankAccount: { select: { id: true, name: true } } },
  });
  if (!txn) return err('Not found', 404);
  return ok(txn);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateBankTransactionInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid bank transaction payload', 400);
  try {
    const txn = await prisma.$transaction(async (tx) => {
      const existing = await tx.bankTransaction.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, bankAccountId: true, type: true, amount: true },
      });
      if (!existing) return null;
      if (parsed.data.bankAccountId) {
        await validateForeignKey(tx.bankAccount, { id: parsed.data.bankAccountId, organizationId: orgId, isActive: true }, 'Bank account not found in organization');
      }
      if (parsed.data.toBankAccountId) {
        await validateForeignKey(tx.bankAccount, { id: parsed.data.toBankAccountId, organizationId: orgId, isActive: true }, 'Destination bank account not found in organization');
      }

      const updated = await tx.bankTransaction.update({
        where: { id, organizationId: orgId },
        data: {
          ...parsed.data,
          ...(parsed.data.date !== undefined && { date: new Date(parsed.data.date) }),
          updatedAt: new Date(),
        },
        include: { bankAccount: { select: { id: true, name: true } } },
      });

      const oldDelta = existing.type === 'INCOME' ? Number(existing.amount) : existing.type === 'TRANSFER' ? 0 : -Number(existing.amount);
      const newType = parsed.data.type ?? existing.type;
      const newAmount = parsed.data.amount ?? Number(existing.amount);
      const newBankAccountId = parsed.data.bankAccountId ?? existing.bankAccountId;
      const newDelta = newType === 'INCOME' ? Number(newAmount) : newType === 'TRANSFER' ? 0 : -Number(newAmount);

      if (existing.bankAccountId === newBankAccountId) {
        const netDelta = newDelta - oldDelta;
        if (netDelta !== 0) {
          await tx.bankAccount.update({
            where: { id: newBankAccountId },
            data: { currentBalance: { increment: netDelta } },
          });
        }
      } else {
        if (oldDelta !== 0) {
          await tx.bankAccount.update({
            where: { id: existing.bankAccountId },
            data: { currentBalance: { increment: -oldDelta } },
          });
        }
        if (newDelta !== 0) {
          await tx.bankAccount.update({
            where: { id: newBankAccountId },
            data: { currentBalance: { increment: newDelta } },
          });
        }
      }

      return updated;
    });
    if (!txn) return err('Not found', 404);
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankTransaction', entityId: id, action: 'UPDATE', payload: body });
    return ok(txn);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to update bank transaction';
    return err(message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  await prisma.bankTransaction.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankTransaction', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
