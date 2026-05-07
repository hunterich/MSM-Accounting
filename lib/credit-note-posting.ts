/**
 * GL posting for CreditNote applied transition.
 *
 * Mirrors `lib/sales-return-posting.ts` but covers only the AR side
 * (notes have no inventory leg). Books DR Sales-Return / CR AR for the
 * credit-note amount.
 *
 * Idempotency: the CreditNote schema does not have a `journalEntryId`
 * column, so callers must guard against double-posting at the status-
 * transition boundary. The convention is: only call this from a
 * DRAFT → APPLIED PUT, and forbid APPLIED → DRAFT in that handler so
 * the same note can never re-enter DRAFT and re-trigger the post.
 *
 * Throws if account defaults are missing or amount is non-positive,
 * matching the failure mode of `postSalesReturnOnApproval`.
 */
import type { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { toNumber } from './money';

type Tx = Prisma.TransactionClient;

export async function postCreditNoteOnApply(
  tx: Tx,
  creditNoteId: string,
): Promise<void> {
  const cn = await tx.creditNote.findUnique({
    where: { id: creditNoteId },
    select: {
      id: true,
      number: true,
      organizationId: true,
      date: true,
      amount: true,
      returnAccountId: true,
      arAccountId: true,
    },
  });
  if (!cn) throw new Error(`CreditNote ${creditNoteId} not found`);

  const amount = toNumber(cn.amount);
  if (amount <= 0) {
    throw new Error(`CreditNote ${cn.number}: amount must be > 0 to apply`);
  }

  const accounts = await tx.account.findMany({
    where: { organizationId: cn.organizationId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, cn.organizationId);
  const returnAccountId =
    cn.returnAccountId ?? resolveAccountDefaultId(accounts, settings, 'arReturn');
  const arAccountId =
    cn.arAccountId ?? resolveAccountDefaultId(accounts, settings, 'arControl');

  if (!returnAccountId || !arAccountId) {
    throw new Error(
      `CreditNote ${cn.number}: missing arReturn/arControl account defaults`,
    );
  }

  await postJournalEntry(tx, {
    organizationId: cn.organizationId,
    date: cn.date,
    memo: `Credit note: ${cn.number}`,
    lines: [
      {
        accountId: returnAccountId,
        description: `Sales return - ${cn.number}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: arAccountId,
        description: `AR reduction - ${cn.number}`,
        debit: 0,
        credit: amount,
      },
    ],
  });
}
