/**
 * Fiscal-year close — the closing journal entry.
 *
 * Monthly close (lib/period-close.ts) is a lock: it freezes a month but moves
 * no money. Year-end is the other half. Revenue and expense accounts are
 * *nominal* — they measure one year and must start the next at zero — so the
 * close posts one entry that debits every revenue account by its credit
 * balance, credits every expense account by its debit balance, and books the
 * difference to Retained Earnings. Net income becomes equity; the P&L accounts
 * reset.
 *
 * Two design points worth knowing:
 *
 *  - **Balances are movements inside the year, not all-time.** Summing all-time
 *    would double-count every prior year that has already been closed. Within
 *    the year is correct for the first close and every one after it.
 *  - **The entry is dated the last day of the year, inside a period the close
 *    requires to be CLOSED.** That is deliberate: `assertPeriodOpen` guards the
 *    document routes, and the closing entry is not a document — it is the act
 *    of closing. It is the one write that belongs in a locked period, which is
 *    also why only this module builds it.
 */
import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { asMoney } from './money';
import { postJournalEntry } from './journal-posting';
import {
  loadOrgAccountDefaults,
  resolveAccountDefaultId,
  type AccountDefaultsConfig,
} from './account-defaults';

type Tx = Prisma.TransactionClient;

export interface FiscalYearRange {
  startDate: Date;
  endDate: Date;
  /** Display label, e.g. "2026" or "2026/2027" for a non-calendar year. */
  label: string;
}

/** The twelve months from `fiscalYearStart`, ending on its last millisecond. */
export function fiscalYearRange(fiscalYearStart: Date): FiscalYearRange {
  const year = fiscalYearStart.getUTCFullYear();
  const month = fiscalYearStart.getUTCMonth();
  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year + 1, month, 1) - 1);
  const label =
    month === 0 ? String(year) : `${year}/${year + 1}`;
  return { startDate, endDate, label };
}

export interface ClosingLine {
  accountId: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  /** Net movement in the year, signed on the account's normal side. */
  balance: number;
}

export interface ClosingPreview {
  range: FiscalYearRange;
  /** Monthly periods inside the range that are not yet CLOSED. */
  openMonths: string[];
  /** Revenue/expense accounts with a non-zero balance in the year. */
  lines: ClosingLine[];
  totalRevenue: number;
  totalExpense: number;
  /** Positive = profit, negative = loss. */
  netIncome: number;
  retainedEarningsAccountId: string | null;
  retainedEarningsAccountName: string | null;
  /** Already closed? The existing close's entry number, if so. */
  closedEntryNo: string | null;
  canClose: boolean;
  blockedReason: string | null;
}

/** Every monthly period overlapping the year that is still OPEN. */
async function openMonthsInRange(tx: Tx, orgId: string, range: FiscalYearRange): Promise<string[]> {
  const rows = await tx.accountingPeriod.findMany({
    where: {
      organizationId: orgId,
      startDate: { lte: range.endDate },
      endDate: { gte: range.startDate },
      status: { not: 'CLOSED' },
    },
    select: { name: true },
    orderBy: { startDate: 'asc' },
  });
  return rows.map((r) => r.name);
}

/**
 * Net movement per nominal account for the year, from POSTED entries only.
 * Signed on the account's normal side, so a revenue account with more credits
 * than debits comes back positive.
 */
async function nominalBalances(tx: Tx, orgId: string, range: FiscalYearRange): Promise<ClosingLine[]> {
  const rows = await tx.$queryRaw<
    Array<{ accountId: string; code: string; name: string; type: string; debit: string; credit: string }>
  >`
    SELECT a."id"   AS "accountId",
           a."code" AS "code",
           a."name" AS "name",
           a."type"::text AS "type",
           COALESCE(SUM(l."debit"), 0)::text  AS "debit",
           COALESCE(SUM(l."credit"), 0)::text AS "credit"
    FROM "JournalLine" l
    JOIN "JournalEntry" e ON e."id" = l."entryId"
    JOIN "Account" a      ON a."id" = l."accountId"
    WHERE e."organizationId" = ${orgId}
      AND e."status" = 'POSTED'
      AND e."date" >= ${range.startDate}
      AND e."date" <= ${range.endDate}
      AND a."type" IN ('REVENUE', 'EXPENSE')
    GROUP BY a."id", a."code", a."name", a."type"
    ORDER BY a."code"
  `;

  return rows
    .map((r) => {
      const debit = Number(r.debit);
      const credit = Number(r.credit);
      // Revenue is credit-normal, expense debit-normal.
      const balance = r.type === 'REVENUE' ? asMoney(credit - debit) : asMoney(debit - credit);
      return {
        accountId: r.accountId,
        code: r.code,
        name: r.name,
        type: r.type as 'REVENUE' | 'EXPENSE',
        balance,
      };
    })
    // A nominal account that nets to zero needs no closing line.
    .filter((l) => Math.abs(l.balance) > 0.005);
}

async function resolveRetainedEarnings(tx: Tx, orgId: string) {
  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, type: 'EQUITY' },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = (await loadOrgAccountDefaults(tx as never, orgId)) as Partial<AccountDefaultsConfig>;
  const id = resolveAccountDefaultId(accounts, settings, 'retainedEarnings');
  const account = accounts.find((a) => a.id === id) ?? null;
  return account;
}

/** Everything the confirm screen needs, and everything `closeFiscalYear` checks. */
export async function buildClosingPreview(
  tx: Tx,
  orgId: string,
  fiscalYearStart: Date,
): Promise<ClosingPreview> {
  const range = fiscalYearRange(fiscalYearStart);

  const [openMonths, lines, retainedEarnings, existing] = await Promise.all([
    openMonthsInRange(tx, orgId, range),
    nominalBalances(tx, orgId, range),
    resolveRetainedEarnings(tx, orgId),
    tx.fiscalYearClose.findUnique({
      where: { organizationId_startDate: { organizationId: orgId, startDate: range.startDate } },
      select: { closingEntry: { select: { entryNo: true } } },
    }),
  ]);

  const totalRevenue = asMoney(
    lines.filter((l) => l.type === 'REVENUE').reduce((s, l) => s + l.balance, 0),
  );
  const totalExpense = asMoney(
    lines.filter((l) => l.type === 'EXPENSE').reduce((s, l) => s + l.balance, 0),
  );
  const netIncome = asMoney(totalRevenue - totalExpense);

  let blockedReason: string | null = null;
  if (existing) {
    blockedReason = `Fiscal year ${range.label} is already closed (${existing.closingEntry.entryNo}).`;
  } else if (openMonths.length > 0) {
    blockedReason = `Close every month of the year first — still open: ${openMonths.join(', ')}.`;
  } else if (lines.length === 0) {
    blockedReason = `No revenue or expense activity in ${range.label} — nothing to close.`;
  } else if (!retainedEarnings) {
    blockedReason =
      'No Retained Earnings account is set. Pick one under Settings → Account Defaults.';
  }

  return {
    range,
    openMonths,
    lines,
    totalRevenue,
    totalExpense,
    netIncome,
    retainedEarningsAccountId: retainedEarnings?.id ?? null,
    retainedEarningsAccountName: retainedEarnings
      ? `${retainedEarnings.code} — ${retainedEarnings.name}`
      : null,
    closedEntryNo: existing?.closingEntry.entryNo ?? null,
    canClose: blockedReason === null,
    blockedReason,
  };
}

/**
 * Post the closing entry and record the close. Caller owns the transaction.
 *
 * Every nominal account is zeroed by booking the opposite of its balance, and
 * Retained Earnings takes the residual — which is exactly net income, so the
 * entry balances by construction. `postJournalEntry` re-checks that anyway.
 */
export async function closeFiscalYear(
  tx: Tx,
  orgId: string,
  fiscalYearStart: Date,
  userId: string,
): Promise<{ closingEntryId: string; entryNo: string; netIncome: number; range: FiscalYearRange }> {
  const preview = await buildClosingPreview(tx, orgId, fiscalYearStart);
  if (!preview.canClose) {
    throw new ApiError(preview.blockedReason ?? 'Fiscal year cannot be closed', 422);
  }
  const retainedEarningsAccountId = preview.retainedEarningsAccountId!;

  const lines = preview.lines.map((line) => ({
    accountId: line.accountId,
    description: `Close ${line.code} ${line.name}`,
    // Mirror the balance to bring the account to zero: a credit-balance
    // revenue account is debited, a debit-balance expense account credited.
    // A negative balance (contra activity, e.g. more returns than sales)
    // flips the side, which the max(0, …) split below handles.
    debit: line.type === 'REVENUE' ? Math.max(line.balance, 0) : Math.max(-line.balance, 0),
    credit: line.type === 'REVENUE' ? Math.max(-line.balance, 0) : Math.max(line.balance, 0),
  }));

  lines.push({
    accountId: retainedEarningsAccountId,
    description: `Net ${preview.netIncome >= 0 ? 'income' : 'loss'} for ${preview.range.label}`,
    // Profit credits equity, loss debits it.
    debit: Math.max(-preview.netIncome, 0),
    credit: Math.max(preview.netIncome, 0),
  });

  const entry = await postJournalEntry(tx, {
    organizationId: orgId,
    // Last day of the fiscal year — the income belongs to the year it was
    // earned in, not to the day someone happened to run the close.
    date: preview.range.endDate,
    memo: `Closing entry — fiscal year ${preview.range.label}`,
    source: 'CLOSING',
    lines: lines.filter((l) => l.debit > 0 || l.credit > 0),
  });

  await tx.fiscalYearClose.create({
    data: {
      organizationId: orgId,
      startDate: preview.range.startDate,
      endDate: preview.range.endDate,
      closingEntryId: entry.id,
      closedById: userId,
    },
  });

  return {
    closingEntryId: entry.id,
    entryNo: entry.entryNo,
    netIncome: preview.netIncome,
    range: preview.range,
  };
}
