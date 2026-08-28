import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { buildClosingPreview } from '@/lib/fiscal-year-close';
import { resolveFiscalYearStart } from '@/lib/fiscal-year-start';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * What the fiscal-year close would post, and whether it can run at all.
 * Read-only — this is what the confirm screen shows before anything is written.
 */
export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);

  const fiscalYearStart = await resolveFiscalYearStart(prisma, orgId, searchParams.get('fiscalYearStart'));
  if (!fiscalYearStart) {
    throw new ApiError('Set the company fiscal year start before closing a year', 422);
  }

  return ok(await buildClosingPreview(prisma, orgId, fiscalYearStart));
});
