/**
 * GL posting for DebitNote applied transition.
 *
 * Mirrors `lib/purchase-return-posting.ts` — covers the AP side only
 * (notes have no inventory leg). Books DR AP (gross) / CR Purchase-Return
 * (net) / CR Input-Tax (taxAmount, when applyTax) for the debit-note amount.
 *
 * Idempotency: short-circuits when `debitNote.journalEntryId` is already
 * set (DB-token, parity with purchase-return-posting). The PUT handler
 * additionally rejects any `* → DRAFT` transition once the note has left
 * DRAFT. Belt and suspenders.
 *
 * Concurrent-apply race: see `credit-note-posting.ts` — same handling.
 */
import { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { toNumber } from './money';
import { ApiError } from './api-utils';

type Tx = Prisma.TransactionClient;

function isJournalEntryIdUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes('journalEntryId');
  if (typeof target === 'string') return target.includes('journalEntryId');
  return false;
}

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
      taxAmount: true,
      applyTax: true,
      apAccountId: true,
      returnAccountId: true,
      taxAccountId: true,
      journalEntryId: true,
    },
  });
  if (!dn) throw new Error(`DebitNote ${debitNoteId} not found`);

  // Idempotency token — already posted, nothing to do.
  if (dn.journalEntryId) return;

  const amount = toNumber(dn.amount);
  if (amount <= 0) {
    throw new Error(`DebitNote ${dn.number}: amount must be > 0 to apply`);
  }

  // `amount` is the gross total debited against the vendor; `taxAmount` is
  // the Input-Tax (PPN Masukan) portion inside it. It reverses the tax
  // receivable claimed on the original bill.
  const taxAmount = dn.applyTax ? toNumber(dn.taxAmount) : 0;
  if (taxAmount < 0 || taxAmount >= amount) {
    throw new Error(
      `DebitNote ${dn.number}: taxAmount must be >= 0 and below the gross amount`,
    );
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

  const taxAccountId =
    taxAmount > 0
      ? dn.taxAccountId ?? resolveAccountDefaultId(accounts, settings, 'apTax')
      : null;
  if (taxAmount > 0 && !taxAccountId) {
    throw new Error(
      `DebitNote ${dn.number}: taxAmount is set but no Input Tax account is configured (apTax default)`,
    );
  }

  const je = await postJournalEntry(tx, {
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
        credit: amount - taxAmount,
      },
      ...(taxAmount > 0 && taxAccountId
        ? [{
            accountId: taxAccountId,
            description: `Input tax reversal - ${dn.number}`,
            debit: 0,
            credit: taxAmount,
          }]
        : []),
    ],
  });

  try {
    await tx.debitNote.update({
      where: { id: dn.id },
      data: { journalEntryId: je.id, postedAt: new Date() },
    });
  } catch (error) {
    if (isJournalEntryIdUniqueViolation(error)) {
      throw new ApiError(
        `DebitNote ${dn.number} has already been posted to the ledger`,
        409,
      );
    }
    throw error;
  }
}
