/**
 * GL posting for DebitNote applied transition.
 *
 * Mirrors `lib/purchase-return-posting.ts` but covers only the AP side
 * (notes have no inventory leg). Books DR AP / CR Purchase-Return for
 * the debit-note amount.
 *
 * Idempotency: see `credit-note-posting.ts` — the schema has no
 * journalEntryId column, so the calling PUT handler enforces the
 * DRAFT → APPLIED transition guard and refuses APPLIED → DRAFT.
 */
import type { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { toNumber } from './money';

type Tx = Prisma.TransactionClient;

export async function postDebitNoteOnApply(
  tx: Tx,
  debitNoteId: string,
): Promise<void> {
  const dn = await tx.debitNote.findUnique({
    where: { id: debitNoteId },
    select: {
      id: true,
      number: true,
      organizationId: true,
      date: true,
      amount: true,
      apAccountId: true,
      returnAccountId: true,
    },
  });
  if (!dn) throw new Error(`DebitNote ${debitNoteId} not found`);

  const amount = toNumber(dn.amount);
  if (amount <= 0) {
    throw new Error(`DebitNote ${dn.number}: amount must be > 0 to apply`);
  }

  const accounts = await tx.account.findMany({
    where: { organizationId: dn.organizationId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, dn.organizationId);
  const apAccountId =
    dn.apAccountId ?? resolveAccountDefaultId(accounts, settings, 'apControl');
  const returnAccountId =
    dn.returnAccountId ?? resolveAccountDefaultId(accounts, settings, 'apReturn');

  if (!apAccountId || !returnAccountId) {
    throw new Error(
      `DebitNote ${dn.number}: missing apControl/apReturn account defaults`,
    );
  }

  await postJournalEntry(tx, {
    organizationId: dn.organizationId,
    date: dn.date,
    memo: `Debit note: ${dn.number}`,
    lines: [
      {
        accountId: apAccountId,
        description: `AP reduction - ${dn.number}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: returnAccountId,
        description: `Purchase return - ${dn.number}`,
        debit: 0,
        credit: amount,
      },
    ],
  });
}
