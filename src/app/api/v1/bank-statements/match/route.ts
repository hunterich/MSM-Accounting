import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { matchTransferStatementLine } from '@/lib/bank-transfer-statement-match';
import { ApiError } from '@/lib/errors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * MS_PER_DAY;

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

  // Fetch unmatched bank transactions for this bank account
  const bankTxns = await prisma.bankTransaction.findMany({
    where: {
      organizationId: orgId,
      bankAccountId: statement.bankAccountId,
      status: 'UNMATCHED',
      type: { not: 'TRANSFER' },
    },
    select: { id: true, date: true, amount: true },
  });

  // Transfers can have one statement line on each account, with opposite
  // signs. The shared status may already be MATCHED because the other leg was
  // matched; the transactional helper checks the individual account instead.
  const transfers = await prisma.bankTransaction.findMany({ where: {
    organizationId: orgId, type: 'TRANSFER', OR: [{ bankAccountId: statement.bankAccountId }, { toBankAccountId: statement.bankAccountId }],
  }, select: { id: true, date: true, amount: true, bankAccountId: true, toBankAccountId: true } });

  let matchedCount = 0;
  const usedTxIds = new Set<string>();

  for (const line of unmatchedLines) {
    const lineAmount = Number(line.amount);
    const lineTime = new Date(line.date).getTime();

    const candidates = transfers.filter(t => !usedTxIds.has(t.id) &&
      Math.abs((t.bankAccountId === statement.bankAccountId ? -1 : 1) * Number(t.amount) - lineAmount) < 0.01 &&
      Math.abs(t.date.getTime() - lineTime) <= THREE_DAYS_MS);
    // Ambiguous transfers need staff review rather than an arbitrary match.
    if (candidates.length === 1) {
      try {
        await prisma.$transaction(tx => matchTransferStatementLine(tx, orgId, line.id, candidates[0].id));
        usedTxIds.add(candidates[0].id);
        matchedCount++;
        continue;
      } catch (error) {
        // Already matched, stale, or legacy match: leave for manual review.
        if (!(error instanceof ApiError) || ![409, 422].includes(error.status)) throw error;
        continue;
      }
    }
    if (candidates.length > 1) continue;

    const matchedTx = bankTxns.find((tx) => {
      if (usedTxIds.has(tx.id)) return false;
      const txAmount = Number(tx.amount);
      const txTime = new Date(tx.date).getTime();
      return (
        Math.abs(txAmount - lineAmount) < 0.01 &&
        Math.abs(txTime - lineTime) <= THREE_DAYS_MS
      );
    });

    if (matchedTx) {
      usedTxIds.add(matchedTx.id);

      const claimed = await prisma.$transaction(async tx => {
        const lineClaim = await tx.bankStatementLine.updateMany({ where: { id: line.id, matchStatus: 'UNMATCHED', matchedTxId: null }, data: { matchStatus: 'MATCHED', matchedTxId: matchedTx.id } });
        if (!lineClaim.count) return false;
        const transactionClaim = await tx.bankTransaction.updateMany({ where: { id: matchedTx.id, status: 'UNMATCHED' }, data: { status: 'MATCHED' } });
        if (!transactionClaim.count) throw new ApiError('Transaction was matched concurrently', 409);
        return true;
      }).catch(error => {
        if (error instanceof ApiError && error.status === 409) return false;
        throw error;
      });
      if (claimed) matchedCount++;
    }
  }

  const unmatchedRemaining = unmatchedLines.length - matchedCount;

  return ok({ matched: matchedCount, unmatched: unmatchedRemaining });
});
