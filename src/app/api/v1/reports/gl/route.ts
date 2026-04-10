import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import {
  buildBalanceSheetReport,
  buildBalanceSheetMultiPeriodReport,
  buildProfitLossReport,
  buildTrialBalanceReport,
} from '@/lib/gl-reporting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const startOfDay = (value: string | null): Date => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value: string | null): Date => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  date.setHours(23, 59, 59, 999);
  return date;
};

const baseAccountSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  normalSide: true,
  reportGroup: true,
  reportSubGroup: true,
  isPostable: true,
  isActive: true,
};

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'trial-balance';

    const accounts = await prisma.account.findMany({
      where: {
        organizationId: orgId,
        isPostable: true,
      },
      orderBy: { code: 'asc' },
      select: baseAccountSelect,
    });

    if (type === 'trial-balance' || type === 'balance-sheet') {
      const asOfDate = endOfDay(searchParams.get('asOfDate'));
      const lines = await prisma.journalLine.findMany({
        where: {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            date: { lte: asOfDate },
          },
        },
        select: {
          accountId: true,
          debit: true,
          credit: true,
        },
      });

      const payload = type === 'trial-balance'
        ? buildTrialBalanceReport(accounts, lines)
        : buildBalanceSheetReport(accounts, lines);

      return ok({
        type,
        asOfDate,
        ...payload,
      });
    }

    if (type === 'balance-sheet-multi-period') {
      const asOfDate = endOfDay(searchParams.get('asOfDate'));
      const compareAsOfDate = endOfDay(searchParams.get('compareAsOfDate'));

      const [currentLines, compareLines] = await Promise.all([
        prisma.journalLine.findMany({
          where: {
            entry: {
              organizationId: orgId,
              status: 'POSTED',
              date: { lte: asOfDate },
            },
          },
          select: {
            accountId: true,
            debit: true,
            credit: true,
          },
        }),
        prisma.journalLine.findMany({
          where: {
            entry: {
              organizationId: orgId,
              status: 'POSTED',
              date: { lte: compareAsOfDate },
            },
          },
          select: {
            accountId: true,
            debit: true,
            credit: true,
          },
        }),
      ]);

      return ok({
        type,
        asOfDate,
        compareAsOfDate,
        ...buildBalanceSheetMultiPeriodReport(
          buildBalanceSheetReport(accounts, currentLines),
          buildBalanceSheetReport(accounts, compareLines),
        ),
      });
    }

    if (type === 'profit-loss') {
      const dateFrom = startOfDay(searchParams.get('dateFrom'));
      const dateTo = endOfDay(searchParams.get('dateTo'));
      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }

      const lines = await prisma.journalLine.findMany({
        where: {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            date: {
              gte: dateFrom,
              lte: dateTo,
            },
          },
        },
        select: {
          accountId: true,
          debit: true,
          credit: true,
        },
      });

      return ok({
        type,
        dateFrom,
        dateTo,
        ...buildProfitLossReport(accounts, lines),
      });
    }

  return err('Unknown report type', 400);
});
