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

    if (type === 'cash-flow') {
      const dateFrom = startOfDay(searchParams.get('dateFrom'));
      const dateTo = endOfDay(searchParams.get('dateTo'));
      const bankAccountId = searchParams.get('bankAccountId');

      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }

      const txWhere: any = {
        organizationId: orgId,
        date: { gte: dateFrom, lte: dateTo },
      };
      if (bankAccountId) txWhere.bankAccountId = bankAccountId;

      const transactions = await prisma.bankTransaction.findMany({
        where: txWhere,
        orderBy: { date: 'asc' },
        include: {
          bankAccount: { select: { id: true, name: true } },
        },
      });

      type AccountSummary = {
        accountId: string;
        accountName: string;
        totalInflows: number;
        totalOutflows: number;
        net: number;
      };

      const summaryByAccount = new Map<string, AccountSummary>();

      const rows = transactions.map((tx) => {
        const amount = Number(tx.amount);
        const isInflow = tx.type === 'INCOME';
        const isOutflow = tx.type === 'EXPENSE';

        const existing = summaryByAccount.get(tx.bankAccountId) || {
          accountId: tx.bankAccountId,
          accountName: tx.bankAccount.name,
          totalInflows: 0,
          totalOutflows: 0,
          net: 0,
        };

        if (isInflow) existing.totalInflows += amount;
        if (isOutflow) existing.totalOutflows += amount;
        existing.net = existing.totalInflows - existing.totalOutflows;
        summaryByAccount.set(tx.bankAccountId, existing);

        return {
          date: tx.date,
          description: tx.description,
          type: tx.type,
          amount,
          bankAccountId: tx.bankAccountId,
          bankAccountName: tx.bankAccount.name,
        };
      });

      const accountSummaries = Array.from(summaryByAccount.values());
      const overallInflows = accountSummaries.reduce((sum, s) => sum + s.totalInflows, 0);
      const overallOutflows = accountSummaries.reduce((sum, s) => sum + s.totalOutflows, 0);

      return ok({
        type,
        dateFrom,
        dateTo,
        rows,
        summary: {
          byAccount: accountSummaries,
          totalInflows: overallInflows,
          totalOutflows: overallOutflows,
          net: overallInflows - overallOutflows,
        },
      });
    }

    if (type === 'stock-movement') {
      const dateFrom = startOfDay(searchParams.get('dateFrom'));
      const dateTo = endOfDay(searchParams.get('dateTo'));
      const itemId = searchParams.get('itemId');

      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }

      const ledgerWhere: any = {
        organizationId: orgId,
        date: { gte: dateFrom, lte: dateTo },
      };
      if (itemId) ledgerWhere.itemId = itemId;

      const entries = await prisma.inventoryLedgerEntry.findMany({
        where: ledgerWhere,
        orderBy: [{ itemId: 'asc' }, { date: 'asc' }],
        include: {
          item: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
      });

      // Calculate running balance per item
      const runningBalance = new Map<string, number>();

      const rows = entries.map((entry) => {
        const qtyIn = Number(entry.qtyIn);
        const qtyOut = Number(entry.qtyOut);
        const unitCost = Number(entry.unitCost);
        const value = Number(entry.valueChange);

        const prev = runningBalance.get(entry.itemId) ?? 0;
        const next = prev + qtyIn - qtyOut;
        runningBalance.set(entry.itemId, next);

        return {
          date: entry.date,
          documentType: entry.documentType,
          documentId: entry.documentId,
          item: {
            id: entry.item.id,
            name: entry.item.name,
            sku: entry.item.sku,
          },
          warehouse: entry.warehouse
            ? { id: entry.warehouse.id, name: entry.warehouse.name }
            : null,
          qtyIn,
          qtyOut,
          unitCost,
          value,
          runningBalance: next,
        };
      });

      return ok({ type, dateFrom, dateTo, rows });
    }

  return err('Unknown report type', 400);
});
