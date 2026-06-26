import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

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
    },
    select: { id: true, date: true, amount: true },
  });

  let matchedCount = 0;
  const usedTxIds = new Set<string>();

  for (const line of unmatchedLines) {
    const lineAmount = Number(line.amount);
    const lineTime = new Date(line.date).getTime();

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

      await prisma.$transaction([
        prisma.bankStatementLine.update({
          where: { id: line.id },
          data: { matchStatus: 'MATCHED', matchedTxId: matchedTx.id },
        }),
        prisma.bankTransaction.update({
          where: { id: matchedTx.id },
          data: { status: 'MATCHED' },
        }),
      ]);

      matchedCount++;
    }
  }

  const unmatchedRemaining = unmatchedLines.length - matchedCount;

  return ok({ matched: matchedCount, unmatched: unmatchedRemaining });
});
