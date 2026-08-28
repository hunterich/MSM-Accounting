/**
 * Centralized helper for posting balanced journal entries from API routes.
 *
 * Every transactional route (invoice, bill, payment, return, stock adjustment)
 * that mutates real-world value is expected to write a corresponding
 * `JournalEntry` inside its own `prisma.$transaction`. Before this helper
 * existed, two routes (Invoice→SENT and Bill POST) duplicated the
 * sequential-entryNo generation; everything else simply skipped posting.
 *
 * Use this from route handlers — never directly from React components.
 */
import type { Prisma } from '@prisma/client';
import { asMoney } from './money';
import { advisoryLockKey } from './advisory-lock';

type Tx = Prisma.TransactionClient;

export interface JournalLineInput {
  accountId: string;
  description: string;
  debit: number;
  credit: number;
}

export interface PostJournalEntryArgs {
  organizationId: string;
  date: Date;
  memo: string;
  source?: 'SYSTEM' | 'MANUAL' | 'REVERSAL' | 'CLOSING';
  lines: JournalLineInput[];
}

const ENTRY_NO_PREFIX = 'JE-';
const ENTRY_NO_PAD = 6;
export const BALANCE_TOLERANCE = 0.005; // half a cent — covers Decimal rounding edge cases

/**
 * Allocate the next sequential `JE-NNNNNN` entry number for the org. Uses a
 * raw query so it sees uncommitted rows in the same transaction and stays
 * monotonic under sequential POSTs (one transaction at a time per request).
 */
async function nextEntryNo(tx: Tx, organizationId: string): Promise<string> {
  // Serialize entryNo allocation per org (mirrors nextInvoiceNumber). Without
  // it, two concurrent posts read the same MAX and both derive the same next
  // number, colliding on @@unique([organizationId, entryNo]) → one legitimate
  // post rolls back. Transaction-scoped; released at commit/rollback.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`je-seq:${organizationId}`)})`;
  const rows = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER)) AS max_seq
    FROM "JournalEntry"
    WHERE "organizationId" = ${organizationId}
      AND "entryNo" LIKE ${'JE-%'}
  `;
  const nextSeq = Number(rows[0]?.max_seq ?? 0) + 1;
  return `${ENTRY_NO_PREFIX}${String(nextSeq).padStart(ENTRY_NO_PAD, '0')}`;
}

/**
 * Create a balanced journal entry inside an existing transaction. Throws if
 * total debits != total credits (within half-a-cent tolerance) or if the line
 * list is empty. Posts with status POSTED and `postedAt = now`.
 */
export async function postJournalEntry(
  tx: Tx,
  args: PostJournalEntryArgs,
): Promise<{ id: string; entryNo: string }> {
  if (!args.lines.length) {
    throw new Error('postJournalEntry: lines[] is empty');
  }

  const totalDebit = asMoney(args.lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = asMoney(args.lines.reduce((s, l) => s + l.credit, 0));

  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    throw new Error(
      `postJournalEntry: unbalanced — debit=${totalDebit} credit=${totalCredit} (memo: ${args.memo})`,
    );
  }

  const entryNo = await nextEntryNo(tx, args.organizationId);

  const created = await tx.journalEntry.create({
    data: {
      organizationId: args.organizationId,
      entryNo,
      date: args.date,
      memo: args.memo,
      source: args.source ?? 'SYSTEM',
      status: 'POSTED',
      postedAt: new Date(),
      totalDebit,
      totalCredit,
      lines: {
        create: args.lines.map((line, idx) => ({
          lineNo: idx + 1,
          accountId: line.accountId,
          description: line.description,
          debit: asMoney(line.debit),
          credit: asMoney(line.credit),
        })),
      },
    },
    select: { id: true, entryNo: true },
  });

  return created;
}
