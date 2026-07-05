import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

const startOfDay = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfDay = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

type BankTxnRow = {
  id: string; number: string | null; date: Date; description: string;
  amount: unknown; type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  reference: string | null; payee: string | null; receivedFrom: string | null;
  bankAccountId: string; toBankAccountId: string | null;
  journalEntry: { entryNo: string } | null;
};

/** Signed money-in/out a transaction has on a specific account, or null if it
 *  doesn't touch that account. */
function effectOn(t: BankTxnRow, acctId: string): { inAmt: number; outAmt: number } | null {
  const amt = Number(t.amount);
  if (t.type === 'INCOME' && t.bankAccountId === acctId) return { inAmt: amt, outAmt: 0 };
  if (t.type === 'EXPENSE' && t.bankAccountId === acctId) return { inAmt: 0, outAmt: amt };
  if (t.type === 'TRANSFER' && t.bankAccountId === acctId) return { inAmt: 0, outAmt: amt };
  if (t.type === 'TRANSFER' && t.toBankAccountId === acctId) return { inAmt: amt, outAmt: 0 };
  return null;
}

/** Human counterparty for a row, from the perspective of account acctId. */
function counterpartyOf(t: BankTxnRow, acctId: string, nameById: Map<string, string>): string {
  if (t.type === 'INCOME') return t.receivedFrom ?? '';
  if (t.type === 'EXPENSE') return t.payee ?? '';
  if (t.type === 'TRANSFER' && t.bankAccountId === acctId) return nameById.get(t.toBankAccountId ?? '') ?? '';
  if (t.type === 'TRANSFER' && t.toBankAccountId === acctId) return nameById.get(t.bankAccountId) ?? '';
  return '';
}

const TXN_SELECT = {
  id: true, number: true, date: true, description: true, amount: true, type: true,
  reference: true, payee: true, receivedFrom: true, bankAccountId: true, toBankAccountId: true, createdAt: true,
  journalEntry: { select: { entryNo: true } },
} as const;

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
    const orgId = requireOrg(req);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') ?? 'reconciliation-summary';
    const bankAccountId = searchParams.get('bankAccountId') ?? undefined;
    const dateFrom = startOfDay(searchParams.get('dateFrom'));
    const dateTo = endOfDay(searchParams.get('dateTo'));
    const dateWhere = (dateFrom || dateTo)
      ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
      : {};

    if (type === 'bank-history') {
      const accounts = await prisma.bankAccount.findMany({
        where: { organizationId: orgId, isActive: true, ...(bankAccountId ? { id: bankAccountId } : {}) },
        select: { id: true, name: true, code: true, bankName: true, openingBalance: true },
        orderBy: { name: 'asc' },
      });
      const accountIds = accounts.map((a) => a.id);
      if (accountIds.length === 0) return ok({ banks: [], summary: { totalIn: 0, totalOut: 0, netChange: 0 } });

      const allAccounts = await prisma.bankAccount.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
      const nameById = new Map(allAccounts.map((a) => [a.id, a.name] as const));

      const txns = (await prisma.bankTransaction.findMany({
        where: {
          organizationId: orgId,
          ...(dateTo ? { date: { lte: dateTo } } : {}),
          OR: [{ bankAccountId: { in: accountIds } }, { toBankAccountId: { in: accountIds } }],
        },
        select: TXN_SELECT,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })) as unknown as BankTxnRow[];

      const banks = accounts.map((acct) => {
        let opening = Number(acct.openingBalance);
        for (const t of txns) {
          const eff = effectOn(t, acct.id);
          if (eff && dateFrom && t.date < dateFrom) opening += eff.inAmt - eff.outAmt;
        }
        let running = opening;
        let totalIn = 0;
        let totalOut = 0;
        const rows = [] as Array<Record<string, unknown>>;
        for (const t of txns) {
          const eff = effectOn(t, acct.id);
          if (!eff) continue;
          if (dateFrom && t.date < dateFrom) continue;
          running += eff.inAmt - eff.outAmt;
          totalIn += eff.inAmt;
          totalOut += eff.outAmt;
          rows.push({
            bankTransactionId: t.id,
            type: t.type,
            journalEntryNo: t.journalEntry?.entryNo ?? null,
            txnNumber: t.number ?? null,
            date: t.date,
            description: t.description,
            counterparty: counterpartyOf(t, acct.id, nameById),
            reference: t.reference ?? null,
            moneyIn: eff.inAmt,
            moneyOut: eff.outAmt,
            runningBalance: running,
          });
        }
        return {
          bankAccountId: acct.id, bankAccountName: acct.name, bankName: acct.bankName, accountCode: acct.code,
          openingBalance: opening, rows, totalIn, totalOut, closingBalance: running,
        };
      });

      const summary = {
        totalIn: banks.reduce((s, b) => s + b.totalIn, 0),
        totalOut: banks.reduce((s, b) => s + b.totalOut, 0),
        netChange: banks.reduce((s, b) => s + (b.totalIn - b.totalOut), 0),
      };
      return ok({ banks, summary });
    }

    if (type === 'bank-received' || type === 'bank-payment') {
      if (!bankAccountId) {
        const empty = type === 'bank-received'
          ? { rows: [], summary: { count: 0, totalReceived: 0 }, bankAccount: null }
          : { rows: [], summary: { count: 0, totalPaid: 0 }, bankAccount: null };
        return ok(empty);
      }

      const allAccounts = await prisma.bankAccount.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
      const nameById = new Map(allAccounts.map((a) => [a.id, a.name] as const));
      const bankAccount = allAccounts.find((a) => a.id === bankAccountId) ?? null;

      const or = type === 'bank-received'
        ? [{ type: 'INCOME' as const, bankAccountId }, { type: 'TRANSFER' as const, toBankAccountId: bankAccountId }]
        : [{ type: 'EXPENSE' as const, bankAccountId }, { type: 'TRANSFER' as const, bankAccountId }];

      const txns = (await prisma.bankTransaction.findMany({
        where: { organizationId: orgId, ...dateWhere, OR: or },
        select: TXN_SELECT,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })) as unknown as BankTxnRow[];

      const rows = txns.map((t) => {
        const base = {
          bankTransactionId: t.id,
          type: t.type,
          journalEntryNo: t.journalEntry?.entryNo ?? null,
          txnNumber: t.number ?? null,
          date: t.date,
          description: t.description,
          reference: t.reference ?? null,
          amount: Number(t.amount),
        };
        if (type === 'bank-received') {
          return { ...base, from: t.type === 'TRANSFER' ? (nameById.get(t.bankAccountId) ?? '') : (t.receivedFrom ?? '') };
        }
        return { ...base, payee: t.type === 'TRANSFER' ? (nameById.get(t.toBankAccountId ?? '') ?? '') : (t.payee ?? '') };
      });

      const total = rows.reduce((s, r) => s + r.amount, 0);
      const summary = type === 'bank-received'
        ? { count: rows.length, totalReceived: total }
        : { count: rows.length, totalPaid: total };
      return ok({ rows, summary, bankAccount });
    }

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
