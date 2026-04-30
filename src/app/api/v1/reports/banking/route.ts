import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
    const orgId = requireOrg(req);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') ?? 'reconciliation-summary';
    const bankAccountId = searchParams.get('bankAccountId') ?? undefined;

    if (type === 'reconciliation-summary') {
      // Fetch bank accounts (optionally filtered)
      const accounts = await prisma.bankAccount.findMany({
        where: { organizationId: orgId, isActive: true, ...(bankAccountId ? { id: bankAccountId } : {}) },
        select: { id: true, name: true, code: true, bankName: true, currentBalance: true },
        orderBy: { name: 'asc' },
      });

      const rows = await Promise.all(accounts.map(async (account) => {
        // Get all statement lines for this account
        const lines = await prisma.bankStatementLine.findMany({
          where: { statement: { organizationId: orgId, bankAccountId: account.id } },
          select: { amount: true, matchStatus: true },
        });

        // Get the latest statement's ending balance (if any statement has a balance field)
        const latestStatement = await prisma.bankStatement.findFirst({
          where: { organizationId: orgId, bankAccountId: account.id },
          orderBy: { importedAt: 'desc' },
          include: {
            lines: {
              orderBy: { date: 'desc' },
              take: 1,
              select: { balance: true },
            },
          },
        });

        const matchedLines = lines.filter((l) => l.matchStatus === 'MATCHED');
        const unmatchedLines = lines.filter((l) => l.matchStatus === 'UNMATCHED');

        const unmatchedAmount = unmatchedLines.reduce(
          (sum, l) => sum + Number(l.amount),
          0,
        );

        // Statement ending balance from the last line's running balance field
        const statementEndBalance = latestStatement?.lines[0]?.balance != null
          ? Number(latestStatement.lines[0].balance)
          : null;

        const bookBalance = Number(account.currentBalance);
        const variance = statementEndBalance != null ? statementEndBalance - bookBalance : null;

        return {
          accountId: account.id,
          accountName: account.name,
          accountCode: account.code,
          bankName: account.bankName,
          bookBalance,
          statementEndBalance,
          variance,
          totalLines: lines.length,
          matchedCount: matchedLines.length,
          unmatchedCount: unmatchedLines.length,
          unmatchedAmount,
          lastStatementDate: latestStatement?.toDate ?? latestStatement?.importedAt ?? null,
        };
      }));

      const summary = {
        totalAccounts: rows.length,
        totalUnmatched: rows.reduce((s, r) => s + r.unmatchedCount, 0),
        totalUnmatchedAmount: rows.reduce((s, r) => s + r.unmatchedAmount, 0),
      };

      return ok({ rows, summary });
    }

    return ok({ rows: [], summary: {} });
});
