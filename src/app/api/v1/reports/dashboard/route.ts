import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPermission } from '@/lib/authz';
import { requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { reportDate } from '@/lib/subledger-history';
import { readDashboardSales } from '@/lib/dashboard-sales';
import { readJournalTotals } from '@/lib/journal-totals';
import { buildProfitLossReport } from '@/lib/gl-reporting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { asMoney } from '@/lib/money';
import { readCustomerSales } from '@/lib/sales-summary';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const params = new URL(req.url).searchParams;
  const type = params.get('type');
  if (type !== 'sales' && type !== 'profit-loss' && type !== 'customers') return err('Unknown dashboard report type', 400);
  let from: Date, to: Date;
  try {
    from = reportDate(params.get('dateFrom'), false);
    to = reportDate(params.get('dateTo'), true);
  } catch { throw new ApiError('Invalid report date', 400); }
  if (from > to) return err('dateFrom must be before or equal to dateTo', 400);
  if (type === 'customers') {
    const asOf = reportDate(null, true);
    const rows = await readCustomerSales(prisma, { organizationId: orgId, dateFrom: from, dateTo: to > asOf ? asOf : to });
    return ok({ rows: rows.slice(0, 10), grandTotal: asMoney(rows.reduce((sum, row) => sum + row.total, 0)) });
  }
  if (type === 'sales') {
    // Start of the Jakarta day: invoices due today are not overdue yet.
    return ok(await readDashboardSales(prisma, orgId, from, to, reportDate(null, false), reportDate(null, true)));
  }
  const [accounts, defaults, items, lines] = await Promise.all([
    prisma.account.findMany({ where: { organizationId: orgId, isPostable: true } }),
    loadOrgAccountDefaults(prisma, orgId),
    prisma.item.findMany({ where: { organizationId: orgId, cogsAccountId: { not: null } }, select: { cogsAccountId: true }, distinct: ['cogsAccountId'] }),
    readJournalTotals(prisma, { entry: { organizationId: orgId, status: 'POSTED', date: { gte: from, lte: to } } }),
  ]);
  const cogsIds = new Set(items.map(i => i.cogsAccountId));
  cogsIds.add(defaults.cogsExpense ?? '');
  cogsIds.add(resolveAccountDefaultId(accounts, defaults, 'cogsExpense'));
  // Include additional explicitly grouped COGS accounts, including inactive historical ones.
  accounts.filter(a => /^(cogs|cost of goods sold|cost of sales|hpp|harga pokok penjualan)$/i.test(a.reportGroup ?? a.name)).forEach(a => cogsIds.add(a.id));
  const report = buildProfitLossReport(accounts, lines);
  const cogs = asMoney(report.sections.find(s => s.id === 'EXPENSE')!.rows.filter(r => cogsIds.has(r.accountId)).reduce((sum, r) => sum + r.amount, 0));
  return ok({ income: report.summary.totalRevenue, cogs, expenditure: asMoney(report.summary.totalExpense - cogs), profit: report.summary.netIncome });
});
