import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readJournalTotals } from '@/lib/journal-totals';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { reportDate } from '@/lib/subledger-history';
import { loadOrgAccountDefaults, selectCashFlowAccountIds } from '@/lib/account-defaults';
import { readStockMovement } from '@/lib/stock-movement';
import { asMoney } from '@/lib/money';
import {
  buildBalanceSheetReport,
  buildBalanceSheetMultiPeriodReport,
  buildProfitLossReport,
  buildProfitLossMultiPeriodReport,
  buildTrialBalanceReport,
  buildAccountLedgerReport,
  buildCashFlowStatement,
} from '@/lib/gl-reporting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const startOfDay = (value: string | null): Date => {
  try { return reportDate(value, false); } catch { throw new ApiError(`Invalid date: ${value}`, 400); }
};

const endOfDay = (value: string | null): Date => {
  try { return reportDate(value, true); } catch { throw new ApiError(`Invalid date: ${value}`, 400); }
};

const baseAccountSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  normalSide: true,
  reportGroup: true,
  reportSubGroup: true,
  cashFlowClass: true,
  isPostable: true,
  isActive: true,
};

export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'trial-balance';

    // All accounts, not only postable ones: a header that still carries journal
    // lines must keep its balance in the statements (#228).
    const accounts = await prisma.account.findMany({
      where: {
        organizationId: orgId,
      },
      orderBy: { code: 'asc' },
      select: baseAccountSelect,
    });

    if (type === 'trial-balance' || type === 'balance-sheet') {
      const asOfDate = endOfDay(searchParams.get('asOfDate'));
      const lines = await readJournalTotals(prisma, {
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          date: { lte: asOfDate },
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
        readJournalTotals(prisma, {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            date: { lte: asOfDate },
          },
        }),
        readJournalTotals(prisma, {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            date: { lte: compareAsOfDate },
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

      const lines = await readJournalTotals(prisma, {
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          source: { not: 'CLOSING' },
          date: {
            gte: dateFrom,
            lte: dateTo,
          },
        },
      });

      return ok({
        type,
        dateFrom,
        dateTo,
        ...buildProfitLossReport(accounts, lines),
      });
    }

    if (type === 'profit-loss-multi-period') {
      const dateFrom = startOfDay(searchParams.get('dateFrom'));
      const dateTo = endOfDay(searchParams.get('dateTo'));
      const compareDateFrom = startOfDay(searchParams.get('compareDateFrom'));
      const compareDateTo = endOfDay(searchParams.get('compareDateTo'));

      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }
      if (compareDateFrom > compareDateTo) {
        return err('compareDateFrom must be before or equal to compareDateTo', 400);
      }

      const [currentLines, compareLines] = await Promise.all([
        readJournalTotals(prisma, {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            source: { not: 'CLOSING' },
            date: { gte: dateFrom, lte: dateTo },
          },
        }),
        readJournalTotals(prisma, {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            source: { not: 'CLOSING' },
            date: { gte: compareDateFrom, lte: compareDateTo },
          },
        }),
      ]);

      return ok({
        type,
        dateFrom,
        dateTo,
        compareDateFrom,
        compareDateTo,
        ...buildProfitLossMultiPeriodReport(
          buildProfitLossReport(accounts, currentLines),
          buildProfitLossReport(accounts, compareLines),
        ),
      });
    }

    if (type === 'account-ledger') {
      const accountId = searchParams.get('accountId');
      if (!accountId) {
        return err('accountId is required', 400);
      }

      const account = await prisma.account.findFirst({
        where: { id: accountId, organizationId: orgId },
        select: { id: true, code: true, name: true, type: true },
      });

      if (!account) {
        return err('Account not found', 404);
      }

      const dateFrom = startOfDay(searchParams.get('dateFrom'));
      const dateTo = endOfDay(searchParams.get('dateTo'));

      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }

      const [openingLines, periodLines] = await Promise.all([
        readJournalTotals(prisma, {
          accountId,
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            date: { lt: dateFrom },
          },
        }),
        prisma.journalLine.findMany({
          where: {
            accountId,
            entry: {
              organizationId: orgId,
              status: 'POSTED',
              date: { gte: dateFrom, lte: dateTo },
            },
          },
          orderBy: {
            entry: { date: 'asc' },
          },
          select: {
            debit: true,
            credit: true,
            description: true,
            entry: {
              select: {
                date: true,
                entryNo: true,
                memo: true,
              },
            },
          },
        }),
      ]);

      const flatPeriodLines = periodLines.map((line) => ({
        date: line.entry.date,
        entryNo: line.entry.entryNo,
        description: line.description || line.entry.memo,
        debit: line.debit,
        credit: line.credit,
      }));

      return ok({
        type,
        dateFrom,
        dateTo,
        ...buildAccountLedgerReport(account, openingLines, flatPeriodLines),
      });
    }

    if (type === 'cash-flow-statement') {
      const dateFrom = startOfDay(searchParams.get('dateFrom'));
      const dateTo = endOfDay(searchParams.get('dateTo'));

      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }

      const [allAccounts, banks, defaults, beginningLines, periodLines, endingLines] = await Promise.all([
        prisma.account.findMany({ where: { organizationId: orgId }, select: { ...baseAccountSelect, parentId: true } }),
        prisma.bankAccount.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, code: true, bankName: true } }),
        loadOrgAccountDefaults(prisma, orgId),
        readJournalTotals(prisma, {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            date: { lt: dateFrom },
          },
        }),
        readJournalTotals(prisma, {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            // The non-cash transfer would also inflate financing activity.
            source: { not: 'CLOSING' },
            date: { gte: dateFrom, lte: dateTo },
          },
        }),
        readJournalTotals(prisma, { entry: { organizationId: orgId, status: 'POSTED', date: { lte: dateTo } } }),
      ]);

      const bankInputs = banks.map(bank => ({ ...bank, code: bank.code ?? undefined, bankName: bank.bankName ?? undefined }));
      const cashIds = selectCashFlowAccountIds(allAccounts, bankInputs, defaults);
      const report = buildCashFlowStatement(accounts, beginningLines, periodLines, cashIds);
      const selected = new Set(cashIds);
      const balanceSheet = buildBalanceSheetReport(accounts, endingLines);
      const balanceSheetCash = balanceSheet.sections.find(section => section.id === 'ASSET')!.rows
        .filter(row => selected.has(row.accountId)).reduce((sum, row) => sum + row.amount, 0);
      const balanceSheetDifference = Math.round((report.summary.endingCash - balanceSheetCash) * 100) / 100;
      const periodActivityIds = new Set(periodLines.map(line => line.accountId));
      const balanceActivityIds = new Set([...beginningLines, ...endingLines].map(line => line.accountId));
      const unreviewedAccounts = accounts.filter(account => !account.cashFlowClass &&
        (periodActivityIds.has(account.id) || ((account.type === 'ASSET' || account.type === 'LIABILITY') && balanceActivityIds.has(account.id))))
        .map(account => ({ id: account.id, code: account.code, name: account.name }));
      return ok({
        type, dateFrom, dateTo, ...report,
        balanceSheetCash, balanceSheetDifference,
        unreviewedAccounts,
        accumulatedDepreciationActivity: accounts.some(account => account.cashFlowClass === 'ACCUMULATED_DEPRECIATION' && periodLines.some(line => line.accountId === account.id)),
        cashClassificationWarning: cashIds.length === 0,
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
      const warehouseId = searchParams.get('warehouseId');

      if (dateFrom > dateTo) {
        return err('dateFrom must be before or equal to dateTo', 400);
      }

      // One row per item: opening before dateFrom + movement in the range =
      // closing, which equals Stock Valuation as of dateTo for the same scope.
      const rows = await readStockMovement(prisma, orgId, { dateFrom, dateTo, itemId, warehouseId });
      return ok({
        type,
        dateFrom,
        dateTo,
        warehouseId: warehouseId || null,
        rows,
        totals: {
          openingValue: asMoney(rows.reduce((s, r) => s + r.openingValue, 0)),
          movementValue: asMoney(rows.reduce((s, r) => s + r.movementValue, 0)),
          closingValue: asMoney(rows.reduce((s, r) => s + r.closingValue, 0)),
        },
      });
    }

  return err('Unknown report type', 400);
});
