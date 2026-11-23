import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { BANK_MATCH_WINDOW_MS, matchBankStatementLine } from '@/lib/bank-statement-match';
import { bankCashJournal, signedBankCashAmount } from '@/lib/bank-amounts';
import { ApiError } from '@/lib/errors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'BANKING', action: 'edit' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);
  const statementId = searchParams.get('statementId');

  if (!statementId) {
    return err('statementId is required', 400);
  }

  // Validate statement belongs to org, get bankAccountId
  const statement = await prisma.bankStatement.findFirst({
    where: { id: statementId, organizationId: orgId },
    select: { id: true, bankAccountId: true },
  });
  if (!statement) {
    return err('Statement not found', 404);
  }

  // Fetch unmatched statement lines
  const unmatchedLines = await prisma.bankStatementLine.findMany({
    where: { statementId, matchStatus: 'UNMATCHED' },
    select: { id: true, date: true, amount: true },
  });

  if (unmatchedLines.length === 0) {
    return ok({ matched: 0, unmatched: 0 });
  }

  // Transfers may still have an open leg after matching the other account.
  const transactions = await prisma.bankTransaction.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { type: { not: 'TRANSFER' }, bankAccountId: statement.bankAccountId, status: 'UNMATCHED' },
        { type: 'TRANSFER', OR: [{ bankAccountId: statement.bankAccountId }, { toBankAccountId: statement.bankAccountId }] },
      ],
    },
    include: { journalEntry: bankCashJournal },
  });
  const matchedLegs = await prisma.bankStatementLine.findMany({ where: {
    statement: { organizationId: orgId, bankAccountId: statement.bankAccountId },
    matchStatus: 'MATCHED', matchedTxId: { in: transactions.map(t => t.id) },
  }, select: { matchedTxId: true } });
  const usedTxIds = new Set(matchedLegs.map(line => line.matchedTxId));
  const candidates = transactions.map(txn => ({ id: txn.id, date: txn.date, cash: signedBankCashAmount(txn, statement.bankAccountId) }));
  let matchedCount = 0;

  for (const line of unmatchedLines) {
    const matches = candidates.filter(txn => !usedTxIds.has(txn.id) && txn.cash?.eq(line.amount) &&
      Math.abs(txn.date.getTime() - line.date.getTime()) <= BANK_MATCH_WINDOW_MS);
    if (matches.length !== 1) continue;
    try {
      await prisma.$transaction(tx => matchBankStatementLine(tx, orgId, line.id, matches[0].id, true));
      usedTxIds.add(matches[0].id);
      matchedCount++;
    } catch (error) {
      if (!(error instanceof ApiError) || ![404, 409, 422].includes(error.status)) throw error;
    }
  }

  const unmatchedRemaining = unmatchedLines.length - matchedCount;

  return ok({ matched: matchedCount, unmatched: unmatchedRemaining });
});
