import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

/** A transfer has two independently matchable statement legs. Its existing
 * status means at least one leg is matched; the statement lines are the source
 * of truth for which side is matched. No historical matches are rewritten. */
export async function matchTransferStatementLine(tx: Prisma.TransactionClient, orgId: string, lineId: string, transactionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${transactionId} AND "organizationId" = ${orgId} FOR UPDATE`;
  const transaction = await tx.bankTransaction.findFirst({ where: { id: transactionId, organizationId: orgId, type: 'TRANSFER' } });
  const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, statement: { organizationId: orgId } }, include: { statement: true } });
  if (!transaction || !line || !transaction.toBankAccountId || transaction.toBankAccountId === transaction.bankAccountId) throw new ApiError('Invalid transfer or statement', 422);
  if (line.matchStatus !== 'UNMATCHED' || line.matchedTxId) throw new ApiError('Statement line is already matched', 409);
  const accountId = line.statement.bankAccountId;
  const sign = accountId === transaction.bankAccountId ? -1 : accountId === transaction.toBankAccountId ? 1 : 0;
  if (!sign || Math.abs(Number(line.amount) - sign * Number(transaction.amount)) >= 0.01 || Math.abs(line.date.getTime() - transaction.date.getTime()) > 3 * 86400000) {
    throw new ApiError('Transfer account, signed amount or date does not match this statement line', 422);
  }
  const links = await tx.bankStatementLine.findMany({ where: { matchedTxId: transaction.id, matchStatus: 'MATCHED', statement: { organizationId: orgId } }, select: { statement: { select: { bankAccountId: true } } } });
  if (links.some(link => link.statement.bankAccountId === accountId)) throw new ApiError('This transfer is already matched on this account', 409);
  if (transaction.status === 'MATCHED' && links.length === 0) throw new ApiError('This transfer has an existing match without statement evidence; review it first', 409);
  // Lock the line after the transaction; both auto and manual paths use this order.
  const claimed = await tx.bankStatementLine.updateMany({ where: { id: lineId, matchStatus: 'UNMATCHED', matchedTxId: null }, data: { matchStatus: 'MATCHED', matchedTxId: transaction.id } });
  if (claimed.count !== 1) throw new ApiError('Statement line is already matched', 409);
  await tx.bankTransaction.update({ where: { id: transaction.id }, data: { status: 'MATCHED' } });
}

export async function unmatchTransferStatementLine(tx: Prisma.TransactionClient, orgId: string, lineId: string, transactionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "BankTransaction" WHERE "id" = ${transactionId} AND "organizationId" = ${orgId} FOR UPDATE`;
  const transaction = await tx.bankTransaction.findFirst({ where: { id: transactionId, organizationId: orgId, type: 'TRANSFER' } });
  if (!transaction) throw new ApiError('Transfer not found', 404);
  const changed = await tx.bankStatementLine.updateMany({ where: { id: lineId, matchedTxId: transactionId, matchStatus: 'MATCHED', statement: { organizationId: orgId } }, data: { matchStatus: 'UNMATCHED', matchedTxId: null } });
  if (changed.count !== 1) throw new ApiError('Statement match has changed; refresh and retry', 409);
  const remaining = await tx.bankStatementLine.count({ where: { matchedTxId: transactionId, matchStatus: 'MATCHED', statement: { organizationId: orgId } } });
  if (!remaining) await tx.bankTransaction.update({ where: { id: transactionId }, data: { status: 'UNMATCHED' } });
}
