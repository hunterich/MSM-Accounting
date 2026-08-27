import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, logAudit, ok, requireAuth } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { buildFiscalYearPeriods } from '@/lib/organization/bootstrap';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** Defaults to the organization's own fiscalYearStart. */
  fiscalYearStart: z.coerce.date().optional(),
});

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Create the twelve monthly periods for a fiscal year.
 *
 * New companies get these from `bootstrapOrganization`, but an organization
 * created before that existed has none — and with no periods there is nothing
 * to close, so month-end close is simply unavailable to it. This backfills
 * from the same `buildFiscalYearPeriods` definition the bootstrap uses.
 *
 * Idempotent by construction: a month that already exists (by name, or by
 * overlapping an existing period's dates) is skipped rather than duplicated,
 * so re-running is safe and extending into a second fiscal year works.
 */
export const POST = withPermission({ module: 'SETTINGS', action: 'create' }, async function POST(
  req: NextRequest,
) {
  const { orgId, userId } = requireAuth(req);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { fiscalYearStart: true },
  });
  const fiscalStart = parsed.data.fiscalYearStart ?? org?.fiscalYearStart;
  if (!fiscalStart) {
    throw new ApiError('Set the company fiscal year start before generating periods', 422);
  }

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.accountingPeriod.findMany({
      where: { organizationId: orgId },
      select: { name: true, startDate: true, endDate: true },
    });
    const takenNames = new Set(existing.map((p) => p.name));

    // Overlap is checked as well as the name: the periods table forbids
    // overlapping ranges, so a differently-named period covering the same
    // month has to suppress this one or the create would be rejected.
    const overlaps = (start: Date, end: Date) =>
      existing.some((p) => p.startDate <= end && p.endDate >= start);

    const missing = buildFiscalYearPeriods(fiscalStart).filter(
      (p) => !takenNames.has(p.name) && !overlaps(p.startDate, p.endDate),
    );
    if (missing.length === 0) return 0;

    const result = await tx.accountingPeriod.createMany({
      data: missing.map((p) => ({
        organizationId: orgId,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        status: 'OPEN' as const,
      })),
    });
    return result.count;
  });

  if (created > 0) {
    logAudit({
      orgId,
      actorId: userId,
      entityType: 'AccountingPeriod',
      entityId: orgId,
      action: 'CREATE',
      payload: { action: 'generate', created, fiscalYearStart: fiscalStart.toISOString() },
    });
  }

  return ok({ created });
});
