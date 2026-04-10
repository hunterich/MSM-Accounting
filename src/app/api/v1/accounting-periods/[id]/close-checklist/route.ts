import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg, withHandler } from '@/lib/api-utils';

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

  const [unpostedJournals, unreconciledBank, pendingApprovals, overdueInvoices] =
    await Promise.all([
      prisma.journalEntry.count({
        where: { organizationId: orgId, periodId: id, status: 'DRAFT' },
      }),
      prisma.bankTransaction.count({
        where: {
          organizationId: orgId,
          status: 'UNMATCHED',
          date: { gte: period.startDate, lte: period.endDate },
        },
      }),
      prisma.approvalRequest.count({
        where: { organizationId: orgId, status: 'PENDING' },
      }),
      prisma.salesInvoice.count({
        where: { organizationId: orgId, status: 'OVERDUE' },
      }),
    ]);

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
      label: 'Pending approvals',
      count: pendingApprovals,
      blocking: false,
    },
    {
      key: 'overdue_invoices',
      label: 'Overdue invoices',
      count: overdueInvoices,
      blocking: false,
    },
  ];

  const canClose = !items.some((item) => item.blocking && item.count > 0);

  return ok({ items, canClose });
});
