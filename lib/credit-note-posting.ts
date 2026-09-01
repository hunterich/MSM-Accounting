/**
 * GL posting for CreditNote applied transition.
 *
 * Mirrors `lib/sales-return-posting.ts` — covers the AR side only (notes
 * have no inventory leg). Books DR Sales-Return (net) / DR Output-Tax
 * (taxAmount, when applyTax) / CR AR (gross) for the credit-note amount.
 *
 * Idempotency: short-circuits when `creditNote.journalEntryId` is already
 * set (DB-token, parity with sales-return-posting). The PUT handler
 * additionally rejects any `* → DRAFT` transition once the note has left
 * DRAFT, so a voided note can't be re-DRAFTed and re-applied. Belt and
 * suspenders.
 *
 * Concurrent-apply race: if two DRAFT → APPLIED requests both pass the
 * up-front `journalEntryId` check, the second writer's `update` trips
 * the `@unique` constraint on `journalEntryId` (P2002). We catch that
 * specific case and rethrow as `ApiError(409)` so the route returns a
 * clean 409 instead of a generic 500. The transaction rolls back the
 * second writer's JE.create, so no duplicate entry persists.
 */
import { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { toNumber } from './money';
import { ApiError } from './api-utils';
import { assertPeriodOpen } from './period-guard';
import type { TransactionDateGuardOptions } from './transaction-date-policy';

type Tx = Prisma.TransactionClient;

function isJournalEntryIdUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes('journalEntryId');
  if (typeof target === 'string') return target.includes('journalEntryId');
  return false;
}

export async function postCreditNoteOnApply(
  tx: Tx,
  creditNoteId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const cn = await tx.creditNote.findUnique({
    where: { id: creditNoteId },
    select: {
      id: true,
      number: true,
      organizationId: true,
      date: true,
      amount: true,
      taxAmount: true,
      applyTax: true,
      returnAccountId: true,
      arAccountId: true,
      taxAccountId: true,
      journalEntryId: true,
    },
  });
  if (!cn) throw new Error(`CreditNote ${creditNoteId} not found`);

  // Idempotency token — already posted, nothing to do.
  if (cn.journalEntryId) return;

  // Refuse to post into a closed/locked accounting period.
  await assertPeriodOpen(tx, cn.organizationId, cn.date, opts);

  const amount = toNumber(cn.amount);
  if (amount <= 0) {
    throw new Error(`CreditNote ${cn.number}: amount must be > 0 to apply`);
  }

  // `amount` is the gross total credited to the customer; `taxAmount` is the
  // Output-Tax (PPN Keluaran) portion inside it. It reverses the tax payable
  // booked on the original invoice instead of inflating sales-return expense.
  const taxAmount = cn.applyTax ? toNumber(cn.taxAmount) : 0;
  if (taxAmount < 0 || taxAmount >= amount) {
    throw new Error(
      `CreditNote ${cn.number}: taxAmount must be >= 0 and below the gross amount`,
    );
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

  const taxAccountId =
    taxAmount > 0
      ? cn.taxAccountId ?? resolveAccountDefaultId(accounts, settings, 'arTax')
      : null;
  if (taxAmount > 0 && !taxAccountId) {
    throw new Error(
      `CreditNote ${cn.number}: taxAmount is set but no Output Tax account is configured (arTax default)`,
    );
  }

  const je = await postJournalEntry(tx, {
    organizationId: cn.organizationId,
    date: cn.date,
    memo: `Credit note: ${cn.number}`,
    lines: [
      {
        accountId: returnAccountId,
        description: `Sales return - ${cn.number}`,
        debit: amount - taxAmount,
        credit: 0,
      },
      ...(taxAmount > 0 && taxAccountId
        ? [{
            accountId: taxAccountId,
            description: `Output tax reversal - ${cn.number}`,
            debit: taxAmount,
            credit: 0,
          }]
        : []),
      {
        accountId: arAccountId,
        description: `AR reduction - ${cn.number}`,
        debit: 0,
        credit: amount,
      },
    ],
  });

  try {
    await tx.creditNote.update({
      where: { id: cn.id },
      data: { journalEntryId: je.id, postedAt: new Date() },
    });
  } catch (error) {
    if (isJournalEntryIdUniqueViolation(error)) {
      throw new ApiError(
        `CreditNote ${cn.number} has already been posted to the ledger`,
        409,
      );
    }
    throw error;
  }
}
