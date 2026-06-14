import type { Prisma } from '@prisma/client';
import { toNumber } from './money';
import { ApiError } from './errors';
import { postJournalEntry } from './journal-posting';

type Tx = Prisma.TransactionClient;

/**
 * Post the storno of an existing journal entry: a fresh, balanced entry with
 * every line's debit/credit swapped (positive amounts — the codebase never
 * posts negative lines), sourced REVERSAL. Returns the new entry.
 *
 * The original entry is left untouched (append-only ledger). Callers are
 * responsible for guarding against double-reversal at the document level.
 */
export async function reverseJournalEntry(
  tx: Tx,
  originalJeId: string,
  opts: { date: Date; memo: string },
): Promise<{ id: string; entryNo: string }> {
  const original = await tx.journalEntry.findUnique({
    where: { id: originalJeId },
    select: {
      organizationId: true,
      lines: { select: { accountId: true, description: true, debit: true, credit: true } },
    },
  });
  if (!original) {
    throw new ApiError(`Cannot reverse journal entry ${originalJeId}: not found`, 422);
  }

  const lines = original.lines.map((l) => ({
    accountId: l.accountId,
    description: `Reversal: ${l.description ?? ''}`.trim(),
    debit: toNumber(l.credit),
    credit: toNumber(l.debit),
  }));

  return postJournalEntry(tx, {
    organizationId: original.organizationId,
    date: opts.date,
    memo: opts.memo,
    source: 'REVERSAL',
    lines,
  });
}
