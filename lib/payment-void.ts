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
  markVoid: (tx: Tx, orgId: string, id: string) => Promise<unknown>;
}

/**
 * Shared void core: reverse the payment's posting entry, drop its allocations
 * so the settled bills/invoices revert (outstanding is derived from
 * allocations), and mark the payment VOID. Period-guarded; VOID is terminal.
 *
 * Only posted payments (those with a journal entry) can be voided — an unposted
 * draft has no GL impact and should simply be deleted.
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
  await reverseJournalEntry(tx, payment.journalEntryId, {
    date: opts.date,
    memo: `Void ${cfg.label}: ${payment.number}`,
  });
  await cfg.deleteAllocations(tx, paymentId);
  await cfg.markVoid(tx, orgId, paymentId);
}

const AP_CONFIG: VoidConfig = {
  label: 'AP payment',
  find: (tx, orgId, id) =>
    tx.aPPayment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  deleteAllocations: (tx, id) => tx.aPPaymentAllocation.deleteMany({ where: { paymentId: id } }),
  markVoid: (tx, orgId, id) => tx.aPPayment.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

const AR_CONFIG: VoidConfig = {
  label: 'AR receipt',
  find: (tx, orgId, id) =>
    tx.aRPayment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  deleteAllocations: (tx, id) => tx.aRPaymentAllocation.deleteMany({ where: { paymentId: id } }),
  markVoid: (tx, orgId, id) => tx.aRPayment.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

export function voidApPayment(tx: Tx, orgId: string, paymentId: string, opts: { date: Date }): Promise<void> {
  return voidPayment(tx, orgId, paymentId, opts, AP_CONFIG);
}

export function voidArPayment(tx: Tx, orgId: string, paymentId: string, opts: { date: Date }): Promise<void> {
  return voidPayment(tx, orgId, paymentId, opts, AR_CONFIG);
}
