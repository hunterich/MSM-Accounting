import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { countUnpostedInPeriod } from '@/lib/period-close';
import { pendingFinancialInPeriod } from '@/lib/approval/financial-period';
import { reconcileControlAccounts } from '@/lib/control-reconciliation';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);

  const period = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  if (!period) return err('Accounting period not found', 404);

  const [unpostedJournals, unreconciledBank, pendingApprovals, overdueInvoices, arControls, apControls] =
    await Promise.all([
      // By DATE, not periodId — see lib/period-close.ts for why the periodId
      // column cannot be trusted for membership.
      countUnpostedInPeriod(prisma, orgId, period.startDate, period.endDate),
      prisma.bankTransaction.count({
        where: {
          organizationId: orgId,
          status: 'UNMATCHED',
          date: { gte: period.startDate, lte: period.endDate },
        },
      }),
      pendingFinancialInPeriod(prisma, orgId, period.startDate, period.endDate),
      prisma.salesInvoice.count({
        where: { organizationId: orgId, status: 'OVERDUE' },
      }),
      reconcileControlAccounts(prisma, orgId, 'ar', period.endDate),
      reconcileControlAccounts(prisma, orgId, 'ap', period.endDate),
    ]);
  // Named differences are for finance review; no close-blocking policy exists yet.
  const controlDifferences = [...arControls.accounts, ...apControls.accounts]
    .filter((account) => Math.abs(account.difference) >= 0.005 || account.items.length > 0)
    .map(({ accountId, accountCode, accountName, glBalance, subledgerBalance, difference, items }) =>
      ({ accountId, accountCode, accountName, glBalance, subledgerBalance, difference, itemCount: items.length }));

  const items = [
    {
      key: 'unposted_journals',
      label: 'Unposted journal entries',
      count: unpostedJournals,
      blocking: true,
    },
    {
      key: 'unreconciled_bank',
      label: 'Unreconciled bank transactions',
      count: unreconciledBank,
      blocking: false,
    },
    {
      key: 'pending_approvals',
      label: 'Pending financial approvals dated in this period',
      count: pendingApprovals.reduce((sum, item) => sum + item.count, 0),
      blocking: true,
      documentTypes: pendingApprovals.filter(item => item.count > 0),
    },
    {
      key: 'overdue_invoices',
      label: 'Overdue invoices',
      count: overdueInvoices,
      blocking: false,
    },
    {
      key: 'control_differences',
      label: 'AR/AP control accounts with named differences at period end',
      count: controlDifferences.length,
      blocking: false,
      accounts: controlDifferences,
    },
  ];

  const canClose = !items.some((item) => item.blocking && item.count > 0);

  return ok({ items, canClose });
});
