import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { reconcileControlAccounts } from '@/lib/control-reconciliation';
import { reportDate } from '@/lib/subledger-history';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/** GET ?kind=ar|ap&asOfDate=YYYY-MM-DD — read-only AR/AP control reconciliation per GL account. */
export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind');
  if (kind !== 'ar' && kind !== 'ap') return err('kind must be ar or ap', 400);
  let asOf: Date;
  try { asOf = reportDate(searchParams.get('asOfDate'), true); } catch { throw new ApiError(`Invalid date: ${searchParams.get('asOfDate')}`, 400); }
  return ok(await reconcileControlAccounts(prisma, orgId, kind, asOf));
});
