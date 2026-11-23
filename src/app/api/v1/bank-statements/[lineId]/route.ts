import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { matchBankStatementLine, unmatchBankStatementLine } from '@/lib/bank-statement-match';

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
    select: { matchedTxId: true },
  });

  if (!line) {
    return err('Statement line not found', 404);
  }

  if (action === 'unmatch') {
    const previousTxId = line.matchedTxId;
    if (previousTxId) await prisma.$transaction(tx => unmatchBankStatementLine(tx, orgId, lineId, previousTxId));
    return ok(await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } }));
  }

  // action === 'match'
  if (!matchedTxId) {
    return err('matchedTxId is required for action "match"', 400);
  }

  await prisma.$transaction(db => matchBankStatementLine(db, orgId, lineId, matchedTxId));
  return ok(await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } }));
});
