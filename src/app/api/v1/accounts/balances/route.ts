// GET /api/v1/accounts/balances[?asOfDate=YYYY-MM-DD]
//   → { asOfDate, balances: { [accountId]: netDebit } }
//
// Net debit balance (debits − credits) of every account with POSTED journal
// lines, for the Chart of Accounts screen. Headers are absent here: the
// screen rolls children up into their parents itself (`rollupBalances`).
// Guarded by GL_COA rather than REPORTS so the chart can show balances to
// anyone allowed to see the chart.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { asMoney, toNumber } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'GL_COA', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const raw = req.nextUrl.searchParams.get('asOfDate');
  let asOfDate: Date | null = null;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return err('asOfDate must be YYYY-MM-DD', 400);
    asOfDate = new Date(`${raw}T23:59:59.999Z`);
    if (Number.isNaN(asOfDate.getTime())) return err('asOfDate is not a valid date', 400);
  }

  const sums = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: {
      entry: {
        organizationId: orgId,
        status: 'POSTED',
        ...(asOfDate ? { date: { lte: asOfDate } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });

  const balances: Record<string, number> = {};
  for (const row of sums) {
    balances[row.accountId] = asMoney(toNumber(row._sum.debit) - toNumber(row._sum.credit));
  }
  return ok({ asOfDate: asOfDate ? asOfDate.toISOString() : null, balances });
});
