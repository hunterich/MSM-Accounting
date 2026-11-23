import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { bankCashJournal, signedBankCashAmount } from './bank-amounts';

export const BANK_MATCH_WINDOW_MS = 3 * 86400000;

/** Transfers have two independently matchable statement legs. */
export async function matchBankStatementLine(
  tx: Prisma.TransactionClient, orgId: string, lineId: string, transactionId: string, auto = false,
) {
  await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${transactionId} AND "organizationId" = ${orgId} FOR UPDATE`;
  const transaction = await tx.bankTransaction.findFirst({
    where: { id: transactionId, organizationId: orgId }, include: { journalEntry: bankCashJournal },
  });
  const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, statement: { organizationId: orgId } }, include: { statement: true } });
  if (!transaction || !line) throw new ApiError('Bank transaction or statement line not found', 404);
  const isTransfer = transaction.type === 'TRANSFER';
  if (isTransfer && (!transaction.toBankAccountId || transaction.toBankAccountId === transaction.bankAccountId)) {
    throw new ApiError('Invalid transfer accounts', 422);
  }
  if (line.matchStatus !== 'UNMATCHED' || line.matchedTxId) throw new ApiError('Statement line is already matched', 409);
  const accountId = line.statement.bankAccountId;
  const cash = signedBankCashAmount(transaction, accountId);
  if (!cash?.eq(line.amount) ||
      ((isTransfer || auto) && Math.abs(line.date.getTime() - transaction.date.getTime()) > BANK_MATCH_WINDOW_MS)) {
    throw new ApiError('The account, signed cash amount, or date does not match this statement line', 422);
  }
  if (isTransfer) {
    const links = await tx.bankStatementLine.findMany({ where: { matchedTxId: transaction.id, matchStatus: 'MATCHED', statement: { organizationId: orgId } }, select: { statement: { select: { bankAccountId: true } } } });
    if (links.some(link => link.statement.bankAccountId === accountId)) throw new ApiError('This transfer is already matched on this account', 409);
    if (transaction.status === 'MATCHED' && links.length === 0) throw new ApiError('This transfer has an existing match without statement evidence; review it first', 409);
  } else if (transaction.status === 'MATCHED') {
    throw new ApiError('Bank transaction is already matched', 409);
  }
  // Lock the line after the transaction; both auto and manual paths use this order.
  const claimed = await tx.bankStatementLine.updateMany({ where: { id: lineId, matchStatus: 'UNMATCHED', matchedTxId: null }, data: { matchStatus: 'MATCHED', matchedTxId: transaction.id } });
  if (claimed.count !== 1) throw new ApiError('Statement line is already matched', 409);
  await tx.bankTransaction.update({ where: { id: transaction.id }, data: { status: 'MATCHED' } });
}

export async function unmatchBankStatementLine(tx: Prisma.TransactionClient, orgId: string, lineId: string, transactionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${transactionId} AND "organizationId" = ${orgId} FOR UPDATE`;
  const changed = await tx.bankStatementLine.updateMany({ where: { id: lineId, matchedTxId: transactionId, matchStatus: 'MATCHED', statement: { organizationId: orgId } }, data: { matchStatus: 'UNMATCHED', matchedTxId: null } });
  if (changed.count !== 1) throw new ApiError('Statement match has changed; refresh and retry', 409);
  const remaining = await tx.bankStatementLine.count({ where: { matchedTxId: transactionId, matchStatus: 'MATCHED', statement: { organizationId: orgId } } });
  if (!remaining) await tx.bankTransaction.updateMany({ where: { id: transactionId, organizationId: orgId }, data: { status: 'UNMATCHED' } });
}
