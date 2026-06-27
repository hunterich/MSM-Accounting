import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';

type Tx = Prisma.TransactionClient;

interface NoteRow {
  id: string;
  number: string;
  status: string;
  journalEntryId: string | null;
}

interface VoidConfig {
  label: string;
  find: (tx: Tx, orgId: string, id: string) => Promise<NoteRow | null>;
  /**
   * Atomically claim VOID: `updateMany` guarded by `status != 'VOID'`, returning
   * the affected count. The WHERE clause takes a row lock, so a concurrent void
   * blocks here, then sees the row already VOID → count 0 → 409. It must run
   * BEFORE the GL reversal so only the winner reverses (no double-reversal).
   */
  claimVoid: (tx: Tx, orgId: string, id: string) => Promise<{ count: number }>;
}

/**
 * Shared void core: reverse the note's posting entry (storno) and mark it VOID.
 * Period-guarded; VOID is terminal. The original posting JE and the note's
 * journalEntryId are left intact (append-only ledger + audit trail); the PUT
 * handler separately blocks any `* -> DRAFT` transition, so a voided note can
 * never be re-applied to post a second entry.
 *
 * Only posted notes (APPLIED, with a journalEntryId) can be voided — an
 * unposted draft has no GL impact and should simply be deleted.
 *
 * Concurrency-safe: VOID is claimed atomically (guarded `updateMany`) BEFORE
 * `reverseJournalEntry`, so two concurrent voids cannot both reverse the entry.
 */
async function voidNote(
  tx: Tx,
  orgId: string,
  id: string,
  opts: { date: Date },
  cfg: VoidConfig,
): Promise<void> {
  const note = await cfg.find(tx, orgId, id);
  if (!note) {
    throw new ApiError(`${cfg.label} not found`, 404);
  }
  if (note.status === 'VOID') {
    throw new ApiError(`${cfg.label} is already voided`, 422);
  }
  if (!note.journalEntryId) {
    throw new ApiError(`${cfg.label} is not posted — delete the draft instead of voiding`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);

  const claim = await cfg.claimVoid(tx, orgId, id);
  if (claim.count !== 1) {
    throw new ApiError(`${cfg.label} is already voided`, 409);
  }

  await reverseJournalEntry(tx, note.journalEntryId, {
    date: opts.date,
    memo: `Void ${cfg.label}: ${note.number}`,
  });
}

const CN_CONFIG: VoidConfig = {
  label: 'credit note',
  find: (tx, orgId, id) =>
    tx.creditNote.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  claimVoid: (tx, orgId, id) =>
    tx.creditNote.updateMany({ where: { id, organizationId: orgId, status: { not: 'VOID' } }, data: { status: 'VOID' } }),
};

const DN_CONFIG: VoidConfig = {
  label: 'debit note',
  find: (tx, orgId, id) =>
    tx.debitNote.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  claimVoid: (tx, orgId, id) =>
    tx.debitNote.updateMany({ where: { id, organizationId: orgId, status: { not: 'VOID' } }, data: { status: 'VOID' } }),
};

export function voidCreditNote(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidNote(tx, orgId, id, opts, CN_CONFIG);
}

export function voidDebitNote(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidNote(tx, orgId, id, opts, DN_CONFIG);
}
