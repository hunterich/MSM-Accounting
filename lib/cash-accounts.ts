/**
 * Cash on hand, read from the ledger.
 *
 * The Banking module keeps a cached `BankAccount.currentBalance`, but only the
 * bank-transaction screens move it: an AR receipt or an AP payment posts to
 * the bank *GL account* the user picked on the form and never touches the
 * register. Summing the cache therefore showed a dashboard cash figure that
 * did not change when money actually came in or went out. The trial balance
 * was always right, so the dashboard now reads the same source: posted
 * journal lines on the cash & bank accounts.
 *
 * Which accounts are "cash & bank": postable ASSET accounts whose own
 * name/code, report group, or any ancestor's, says so. The keyword list is the
 * one `lib/account-defaults.ts` uses to resolve the default bank asset, so an
 * account the posting code treats as a bank is counted here too; the
 * report-group test matches the cash-flow statement (`lib/gl-reporting.ts`).
 */
import type { Prisma } from '@prisma/client';
import { asMoney, toNumber } from './money';

export interface CashAccountLike {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
  reportGroup?: string | null;
}

const CASH_KEYWORDS = ['bank', 'kas', 'cash', 'giro', 'petty'];

function mentionsCash(account: CashAccountLike): boolean {
  const haystack = `${account.code} ${account.name} ${account.reportGroup ?? ''}`.toLowerCase();
  return CASH_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * The postable asset accounts that hold cash: those that mention cash/bank
 * themselves or sit under a header that does ("Cash and Bank" → "BCA IDR").
 */
export function selectCashAccounts<T extends CashAccountLike>(accounts: readonly T[]): T[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const isCashChain = (account: CashAccountLike): boolean => {
    const seen = new Set<string>();
    let current: CashAccountLike | undefined = account;
    while (current && !seen.has(current.id)) {
      if (String(current.type).toUpperCase() !== 'ASSET') return false;
      if (mentionsCash(current)) return true;
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  return accounts.filter((a) => a.isPostable && String(a.type).toUpperCase() === 'ASSET' && isCashChain(a));
}

type CashDb = Pick<Prisma.TransactionClient, 'account' | 'journalLine'>;

/**
 * Net debit balance of the org's cash & bank accounts across POSTED entries,
 * optionally as of a date (inclusive).
 */
export async function ledgerCashOnHand(
  db: CashDb,
  orgId: string,
  opts: { asOf?: Date } = {},
): Promise<number> {
  const accounts = await db.account.findMany({
    where: { organizationId: orgId, type: 'ASSET' },
    select: { id: true, code: true, name: true, type: true, parentId: true, isPostable: true, reportGroup: true },
  });
  const cashIds = selectCashAccounts(accounts).map((a) => a.id);
  if (cashIds.length === 0) return 0;

  const sums = await db.journalLine.aggregate({
    where: {
      accountId: { in: cashIds },
      entry: {
        organizationId: orgId,
        status: 'POSTED',
        ...(opts.asOf ? { date: { lte: opts.asOf } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  return asMoney(toNumber(sums._sum.debit) - toNumber(sums._sum.credit));
}
