import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, logAudit, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateBankTransactionInputSchema } from '@/types/api';
import { postBankTransactionIfNeeded, reverseBankTransactionPosting } from '@/lib/bank-transaction-posting';
import { bankCashJournal, recordedBankCashAmount } from '@/lib/bank-amounts';
import { roundMoneyDecimal } from '@/lib/money-decimal';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'BANKING', action: 'view' }, async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const txn = await prisma.bankTransaction.findFirst({
    where: { id, organizationId: orgId },
    include: { bankAccount: { select: { id: true, name: true } }, journalEntry: bankCashJournal },
  });
  if (!txn) return err('Not found', 404);
  const { journalEntry, ...transaction } = txn;
  return ok({ ...transaction, cashAmount: recordedBankCashAmount(txn) });
});

async function assertNoStatementMatch(tx: Prisma.TransactionClient, txn: {
  id: string; organizationId: string; type: string; status: string;
}) {
  if ((txn.type === 'TRANSFER' && txn.status === 'MATCHED') ||
      await tx.bankStatementLine.count({ where: { matchedTxId: txn.id, matchStatus: 'MATCHED', statement: { organizationId: txn.organizationId } } })) {
    throw new ApiError('Unmatch the bank statement lines before changing this transaction.', 409);
  }
}

export const PUT = withPermission({ module: 'BANKING', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateBankTransactionInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid bank transaction payload', 400);
  try {
    const txn = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
      const existing = await tx.bankTransaction.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) return null;
      await assertNoStatementMatch(tx, existing);
      if (parsed.data.bankAccountId) {
        await validateForeignKey(tx.bankAccount, { id: parsed.data.bankAccountId, organizationId: orgId, isActive: true }, 'Bank account not found in organization');
      }
      if (parsed.data.toBankAccountId) {
        await validateForeignKey(tx.bankAccount, { id: parsed.data.toBankAccountId, organizationId: orgId, isActive: true }, 'Destination bank account not found in organization');
      }

      // Reverse the original posting: storno its journal entry (if any) and back
      // out the cached-balance moves it applied, so the GL and cached balances
      // start from a clean slate before re-posting.
      const undoMoves = await reverseBankTransactionPosting(tx, orgId, existing);
      for (const move of undoMoves) {
        if (!move.delta.isZero()) {
          await tx.bankAccount.update({
            where: { id: move.bankAccountId },
            data: { currentBalance: { increment: move.delta } },
          });
        }
      }

      // Apply the edit and clear journalEntryId so the re-post is not a no-op.
      await tx.bankTransaction.update({
        where: { id, organizationId: orgId },
        data: {
          ...parsed.data,
          ...(parsed.data.amount !== undefined && { amount: roundMoneyDecimal(parsed.data.amount) }),
          ...(parsed.data.taxRate !== undefined && { taxRate: roundMoneyDecimal(parsed.data.taxRate) }),
          ...(parsed.data.date !== undefined && { date: new Date(parsed.data.date) }),
          journalEntryId: null,
          cashAmount: null,
          updatedAt: new Date(),
        },
      });

      // Re-post the GL entry from the edited data (EXPENSE / INCOME / TRANSFER)
      // and move every affected bank account's cached balance in lockstep with
      // the ledger — both source and destination for a transfer.
      const posting = await postBankTransactionIfNeeded(tx, orgId, id);
      for (const move of posting.moves) {
        if (!move.delta.isZero()) {
          await tx.bankAccount.update({
            where: { id: move.bankAccountId },
            data: { currentBalance: { increment: move.delta } },
          });
        }
      }

      return tx.bankTransaction.findFirst({
        where: { id, organizationId: orgId },
        include: { bankAccount: { select: { id: true, name: true } } },
      });
    });
    if (!txn) return err('Not found', 404);
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankTransaction', entityId: id, action: 'UPDATE', payload: body });
    return ok(txn);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to update bank transaction';
    return err(message, 500);
  }
});

export const DELETE = withPermission({ module: 'BANKING', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
    const existing = await tx.bankTransaction.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return null;
    await assertNoStatementMatch(tx, existing);
    if (existing.journalEntryId) {
      throw new ApiError('This expense has already been posted to the ledger and cannot be deleted — void it instead.', 409);
    }

    // Atomically claim the delete BEFORE touching the balance. The guarded
    // `deleteMany` takes a row lock; a concurrent delete blocks here, then finds
    // the row already gone → count 0 → 409, so only the winner increments the
    // bank-account balance (a double-delete would otherwise double-increment it).
    const del = await tx.bankTransaction.deleteMany({
      where: { id, organizationId: orgId, journalEntryId: null },
    });
    if (del.count !== 1) {
      throw new ApiError('Transaction not found or already posted', 409);
    }

    const undoMoves = await reverseBankTransactionPosting(tx, orgId, existing);
    for (const move of undoMoves) {
      await tx.bankAccount.update({
        where: { id: move.bankAccountId },
        data: { currentBalance: { increment: move.delta } },
      });
    }

    return existing;
  });
  if (!deleted) return err('Not found', 404);
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankTransaction', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to delete bank transaction';
    return err(message, 500);
  }
});
