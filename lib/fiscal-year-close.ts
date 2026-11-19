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
import { accountingRangeBounds } from './accounting-date';
import { advisoryLockKey } from './advisory-lock';
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
  // By business day, like the reports: an older clock-time entry at 01:00 WIB
  // on the first day of the next year belongs to the next year, not this one.
  const bounds = accountingRangeBounds(range.startDate, range.endDate);
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
      AND e."date" >= ${bounds.gte}
      AND e."date" <= ${bounds.lte}
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

/** Per-org, transaction-scoped lock taken by every fiscal-year close and reopen. */
export async function lockFiscalYearChanges(tx: Tx, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`fiscal-year:${orgId}`)})`;
}

/** The fiscal year immediately before `range`. */
export function previousFiscalYearRange(range: FiscalYearRange): FiscalYearRange {
  const start = range.startDate;
  return fiscalYearRange(new Date(Date.UTC(start.getUTCFullYear() - 1, start.getUTCMonth(), 1)));
}

/**
 * The previous fiscal year, if it is not closed and still has revenue/expense
 * balances to close. Years must close in order: closing a year while the one
 * before it is open would leave that earlier year's profit out of Retained
 * Earnings. A previous year with nothing to close (e.g. before the company
 * started) does not block. Checking only the immediate previous year is enough,
 * since that year could not have been closed while its own predecessor was open.
 */
async function unclosedPriorYear(
  tx: Tx,
  orgId: string,
  range: FiscalYearRange,
): Promise<FiscalYearRange | null> {
  const prior = previousFiscalYearRange(range);
  const closed = await tx.fiscalYearClose.findUnique({
    where: { organizationId_startDate: { organizationId: orgId, startDate: prior.startDate } },
    select: { id: true },
  });
  if (closed) return null;
  const balances = await nominalBalances(tx, orgId, prior);
  return balances.length > 0 ? prior : null;
}

/** Everything the confirm screen needs, and everything `closeFiscalYear` checks. */
export async function buildClosingPreview(
  tx: Tx,
  orgId: string,
  fiscalYearStart: Date,
): Promise<ClosingPreview> {
  const range = fiscalYearRange(fiscalYearStart);

  const [openMonths, lines, retainedEarnings, existing, openPriorYear] = await Promise.all([
    openMonthsInRange(tx, orgId, range),
    nominalBalances(tx, orgId, range),
    resolveRetainedEarnings(tx, orgId),
    tx.fiscalYearClose.findUnique({
      where: { organizationId_startDate: { organizationId: orgId, startDate: range.startDate } },
      select: { closingEntry: { select: { entryNo: true } } },
    }),
    unclosedPriorYear(tx, orgId, range),
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
  } else if (openPriorYear) {
    blockedReason =
      `Close fiscal year ${openPriorYear.label} first — it still has revenue and expense balances. ` +
      'Years close in order, so each one starts from the previous year\'s closing balances.';
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
  // Serialize year close with reopening any overlapping month. Re-read the
  // preview only after these locks: a reopen that won the race must block close.
  // The fiscal-year lock does the same for closing/reopening a neighbouring year,
  // so the in-order checks cannot be raced.
  await lockFiscalYearChanges(tx, orgId);
  const range = fiscalYearRange(fiscalYearStart);
  await tx.$queryRaw`SELECT "id" FROM "AccountingPeriod"
    WHERE "organizationId" = ${orgId} AND "startDate" <= ${range.endDate} AND "endDate" >= ${range.startDate}
    ORDER BY "startDate", "id" FOR UPDATE`;
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
    // Dated on the last business day of the year, on the same accounting-date
    // convention as every other journal (00:00 UTC of that day). endDate is the
    // year's last UTC millisecond — a boundary, not an instant — so take its
    // calendar day directly rather than converting it to Jakarta time.
    date: new Date(`${preview.range.endDate.toISOString().slice(0, 10)}T00:00:00.000Z`),
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
