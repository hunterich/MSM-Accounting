import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { matchTransferStatementLine, unmatchTransferStatementLine } from '@/lib/bank-transfer-statement-match';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const PUT = withPermission({ module: 'BANKING', action: 'edit' }, async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ lineId: string }> },
) {
  const orgId = requireOrg(req);
  const { lineId } = await ctx.params;

  const body = await req.json();
  const { matchedTxId, action } = body as {
    matchedTxId?: string | null;
    action?: 'match' | 'unmatch';
  };

  if (!action || (action !== 'match' && action !== 'unmatch')) {
    return err('action must be "match" or "unmatch"', 400);
  }

  // Validate line belongs to org (via statement)
  const line = await prisma.bankStatementLine.findFirst({
    where: {
      id: lineId,
      statement: { organizationId: orgId },
    },
    select: { id: true, matchStatus: true, matchedTxId: true, statement: { select: { bankAccountId: true } } },
  });

  if (!line) {
    return err('Statement line not found', 404);
  }

  if (action === 'unmatch') {
    const previousTxId = line.matchedTxId;

    const transfer = previousTxId && await prisma.bankTransaction.findFirst({ where: { id: previousTxId, organizationId: orgId, type: 'TRANSFER' }, select: { id: true } });
    if (transfer) {
      await prisma.$transaction(tx => unmatchTransferStatementLine(tx, orgId, lineId, transfer.id));
      return ok(await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } }));
    }

    // Both writes must commit together: a failure between them would leave the
    // line UNMATCHED while the bank transaction stays MATCHED (orphaned state).
    const updated = await prisma.$transaction(async (txdb) => {
      const result = await txdb.bankStatementLine.update({
        where: { id: lineId },
        data: { matchStatus: 'UNMATCHED', matchedTxId: null },
      });

      // Reset the previously matched transaction if present
      if (previousTxId) {
        await txdb.bankTransaction.updateMany({
          where: {
            id: previousTxId,
            organizationId: orgId,
            status: 'MATCHED',
          },
          data: { status: 'UNMATCHED' },
        });
      }

      return result;
    });

    return ok(updated);
  }

  // action === 'match'
  if (!matchedTxId) {
    return err('matchedTxId is required for action "match"', 400);
  }

  // Validate the transaction belongs to this org
  const tx = await prisma.bankTransaction.findFirst({
    where: { id: matchedTxId, organizationId: orgId },
    select: { id: true, type: true, bankAccountId: true },
  });
  if (!tx) {
    throw new ApiError('Bank transaction not found in organization', 404);
  }

  if (tx.type === 'TRANSFER') {
    await prisma.$transaction(db => matchTransferStatementLine(db, orgId, lineId, tx.id));
    return ok(await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } }));
  }

  if (tx.bankAccountId !== line.statement.bankAccountId) throw new ApiError('Transaction belongs to another bank account', 422);

  const updatedLine = await prisma.$transaction(async db => {
    const claimed = await db.bankStatementLine.updateMany({ where: { id: lineId, matchStatus: 'UNMATCHED', matchedTxId: null }, data: { matchStatus: 'MATCHED', matchedTxId } });
    if (claimed.count !== 1) throw new ApiError('Statement line is already matched', 409);
    await db.bankTransaction.update({ where: { id: matchedTxId }, data: { status: 'MATCHED' } });
    return db.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
  });

  return ok(updatedLine);
});
