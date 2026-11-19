import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireAuth } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { fiscalYearRange, lockFiscalYearChanges } from '@/lib/fiscal-year-close';
import { resolveFiscalYearStart } from '@/lib/fiscal-year-start';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Reopen a closed fiscal year by deleting its closing journal entry.
 *
 * Only the latest closed year can be reopened. The deleted entry's number is
 * retired, never issued again (see allocateJournalEntryNumber).
 *
 * Deleting rather than reversing is deliberate: a reversal would leave two
 * entries that net to zero in every subsequent P&L, and re-closing would add a
 * third. The lock and the entry must not drift apart, so the entry and the
 * FiscalYearClose row go together in one transaction — the row's FK cascades
 * when the entry goes, and JournalLine cascades from the entry.
 *
 * The year's monthly periods stay CLOSED: this undoes the closing entry, not
 * the month locks. Reopen those individually if you need to post into them.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(
  req: NextRequest,
) {
  const { orgId, userId } = requireAuth(req);
  const body = (await req.json().catch(() => ({}))) as { fiscalYearStart?: string };

  const fiscalYearStart = await resolveFiscalYearStart(prisma, orgId, body.fiscalYearStart);
  if (!fiscalYearStart) {
    throw new ApiError('Set the company fiscal year start before reopening a year', 422);
  }
  const range = fiscalYearRange(fiscalYearStart);

  const removed = await prisma.$transaction(async (tx) => {
    // Same per-org lock as closeFiscalYear, so a reopen cannot race a close of
    // the following year past the ordering checks on either side.
    await lockFiscalYearChanges(tx, orgId);
    const existing = await tx.fiscalYearClose.findUnique({
      where: { organizationId_startDate: { organizationId: orgId, startDate: range.startDate } },
      select: { id: true, closingEntryId: true, closedById: true, closedAt: true,
                closingEntry: { select: { entryNo: true } } },
    });
    if (!existing) {
      throw new ApiError(`Fiscal year ${range.label} is not closed`, 422);
    }

    // Years reopen in reverse order. A later year's closing entry was computed
    // on top of this one; reopening this year underneath it would let this
    // year's profit change while the later close still stands.
    const later = await tx.fiscalYearClose.findFirst({
      where: { organizationId: orgId, startDate: { gt: range.startDate } },
      orderBy: { startDate: 'desc' },
      select: { startDate: true },
    });
    if (later) {
      const laterLabel = fiscalYearRange(later.startDate).label;
      throw new ApiError(
        `Reopen fiscal year ${laterLabel} first — later years must be reopened before earlier ones.`,
        422,
      );
    }

    // Deleting the entry cascades to its lines AND to the FiscalYearClose row
    // (closingEntryId is onDelete: Cascade), so the two can never survive
    // apart from each other.
    await tx.journalEntry.delete({ where: { id: existing.closingEntryId } });
    return existing;
  });

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'FiscalYearClose',
    entityId: removed.closingEntryId,
    action: 'DELETE',
    payload: {
      action: 'reopen-fiscal-year',
      fiscalYear: range.label,
      // The row is gone, so the trail is the only record of who closed it.
      deletedEntryNo: removed.closingEntry.entryNo,
      previouslyClosedById: removed.closedById,
      previouslyClosedAt: removed.closedAt.toISOString(),
    },
  });

  return ok({ reopened: true, fiscalYear: range.label, deletedEntryNo: removed.closingEntry.entryNo });
});
