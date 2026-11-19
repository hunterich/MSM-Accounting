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
import { toAccountingDate } from './accounting-date';

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
 *
 * Every path that writes a JournalEntry must number it here: this is the one
 * place that holds the per-org lock and records the high-water mark.
 *
 * A posted number is never issued twice. The next number is one past the
 * highest of (a) every number still on the books and (b) the highest number
 * ever issued, kept in `JournalEntrySequence`. (b) is what stops reuse after an
 * entry is deleted (reopening a fiscal year deletes its closing entry); (a)
 * keeps the sequence correct for orgs whose entries predate that table.
 */
export async function allocateJournalEntryNumber(tx: Tx, organizationId: string): Promise<string> {
  // Serialize entryNo allocation per org (mirrors nextInvoiceNumber). Without
  // it, two concurrent posts read the same MAX and both derive the same next
  // number, colliding on @@unique([organizationId, entryNo]) → one legitimate
  // post rolls back. Transaction-scoped; released at commit/rollback.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`je-seq:${organizationId}`)})`;
  const rows = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT GREATEST(
      COALESCE((
        SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER))
        FROM "JournalEntry"
        WHERE "organizationId" = ${organizationId}
          AND "entryNo" LIKE ${'JE-%'}
      ), 0),
      COALESCE((
        SELECT "lastSeq" FROM "JournalEntrySequence" WHERE "organizationId" = ${organizationId}
      ), 0)
    ) AS max_seq
  `;
  const nextSeq = Number(rows[0]?.max_seq ?? 0) + 1;
  await tx.$executeRaw`
    INSERT INTO "JournalEntrySequence" ("organizationId", "lastSeq", "updatedAt")
    VALUES (${organizationId}, ${nextSeq}, NOW())
    ON CONFLICT ("organizationId")
    DO UPDATE SET "lastSeq" = GREATEST("JournalEntrySequence"."lastSeq", EXCLUDED."lastSeq"),
                  "updatedAt" = NOW()
  `;
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

  const entryNo = await allocateJournalEntryNumber(tx, args.organizationId);

  const created = await tx.journalEntry.create({
    data: {
      organizationId: args.organizationId,
      entryNo,
      // One accounting-date convention for every journal: the business day,
      // stored at 00:00 UTC. A clock time (POS sale, import) is folded to the
      // day it happened on; its moment is kept on postedAt.
      date: toAccountingDate(args.date),
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
