import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';

type Tx = Prisma.TransactionClient;

interface PaymentRow {
  id: string;
  number: string;
  status: string;
  journalEntryId: string | null;
}

interface VoidConfig {
  label: string;
  find: (tx: Tx, orgId: string, id: string) => Promise<PaymentRow | null>;
  deleteAllocations: (tx: Tx, id: string) => Promise<unknown>;
  /**
   * Atomically claim VOID: `updateMany` guarded by `status != 'VOID'`, returning
   * the affected count. The WHERE clause takes a row lock, so a concurrent void
   * blocks here, then sees the row already VOID → count 0 → 409. This is the
   * race guard — it must run BEFORE the GL reversal so only the winner reverses.
   */
  claimVoid: (tx: Tx, orgId: string, id: string) => Promise<{ count: number }>;
}

/**
 * Shared void core: reverse the payment's posting entry, drop its allocations
 * so the settled bills/invoices revert (outstanding is derived from
 * allocations), and mark the payment VOID. Period-guarded; VOID is terminal.
 *
 * Only posted payments (those with a journal entry) can be voided — an unposted
 * draft has no GL impact and should simply be deleted.
 *
 * Concurrency-safe: the status is claimed atomically (guarded `updateMany`)
 * BEFORE `reverseJournalEntry`, so two concurrent voids cannot both reverse the
 * journal entry (which would corrupt the ledger). The pre-claim validations
 * still produce the right error messages for drafts / already-voided rows in
 * the common single-caller case; the atomic claim closes the TOCTOU race.
 */
async function voidPayment(
  tx: Tx,
  orgId: string,
  paymentId: string,
  opts: { date: Date },
  cfg: VoidConfig,
): Promise<void> {
  const payment = await cfg.find(tx, orgId, paymentId);
  if (!payment) {
    throw new ApiError(`${cfg.label} not found`, 404);
  }
  if (payment.status === 'VOID') {
    throw new ApiError(`${cfg.label} is already voided`, 422);
  }
  if (!payment.journalEntryId) {
    throw new ApiError(`${cfg.label} is not posted — delete the draft instead of voiding`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);

  // Atomically claim VOID before any GL side effect. A concurrent void blocks on
  // the row lock, then sees status already VOID → count 0 → 409 (no double-reverse).
  const claim = await cfg.claimVoid(tx, orgId, paymentId);
  if (claim.count !== 1) {
    throw new ApiError(`${cfg.label} is already voided`, 409);
  }

  await reverseJournalEntry(tx, payment.journalEntryId, {
    date: opts.date,
    memo: `Void ${cfg.label}: ${payment.number}`,
  });
  await cfg.deleteAllocations(tx, paymentId);
}

const AP_CONFIG: VoidConfig = {
  label: 'AP payment',
  find: (tx, orgId, id) =>
    tx.aPPayment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  deleteAllocations: (tx, id) => tx.aPPaymentAllocation.deleteMany({ where: { paymentId: id } }),
  claimVoid: (tx, orgId, id) =>
    tx.aPPayment.updateMany({ where: { id, organizationId: orgId, status: { not: 'VOID' } }, data: { status: 'VOID' } }),
};

const AR_CONFIG: VoidConfig = {
  label: 'AR receipt',
  find: (tx, orgId, id) =>
    tx.aRPayment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  deleteAllocations: (tx, id) => tx.aRPaymentAllocation.deleteMany({ where: { paymentId: id } }),
  claimVoid: (tx, orgId, id) =>
    tx.aRPayment.updateMany({ where: { id, organizationId: orgId, status: { not: 'VOID' } }, data: { status: 'VOID' } }),
};

export function voidApPayment(tx: Tx, orgId: string, paymentId: string, opts: { date: Date }): Promise<void> {
  return voidPayment(tx, orgId, paymentId, opts, AP_CONFIG);
}

export function voidArPayment(tx: Tx, orgId: string, paymentId: string, opts: { date: Date }): Promise<void> {
  return voidPayment(tx, orgId, paymentId, opts, AR_CONFIG);
}
