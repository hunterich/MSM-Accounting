import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireAuth } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { closeFiscalYear } from '@/lib/fiscal-year-close';
import { resolveFiscalYearStart } from '@/lib/fiscal-year-start';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Close a fiscal year: post the closing journal entry and record the close.
 *
 * Requires every month of the year to be closed first, which is what makes the
 * balances it rolls up final. Reversible via /fiscal-year/reopen.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
) {
  const { orgId, userId } = requireAuth(req);
  const body = (await req.json().catch(() => ({}))) as { fiscalYearStart?: string };

  const fiscalYearStart = await resolveFiscalYearStart(prisma, orgId, body.fiscalYearStart);
  if (!fiscalYearStart) {
    throw new ApiError('Set the company fiscal year start before closing a year', 422);
  }

  let result;
  try {
    result = await prisma.$transaction((tx) => closeFiscalYear(tx, orgId, fiscalYearStart, userId));
  } catch (e) {
    // Two users hitting Close at once: both build a valid entry, one loses the
    // race on FiscalYearClose's unique key. Same pattern as the note-posting
    // routes — surface it as a conflict, not a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError('This fiscal year was closed by someone else just now', 409);
    }
    throw e;
  }

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'FiscalYearClose',
    entityId: result.closingEntryId,
    action: 'CREATE',
    payload: {
      action: 'close-fiscal-year',
      fiscalYear: result.range.label,
      entryNo: result.entryNo,
      netIncome: result.netIncome,
    },
  });

  return ok({
    entryNo: result.entryNo,
    closingEntryId: result.closingEntryId,
    netIncome: result.netIncome,
    fiscalYear: result.range.label,
  }, 201);
});
