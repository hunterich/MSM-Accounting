import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { reversePurchaseLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

const VOIDABLE_STATUSES = new Set(['OPEN', 'PENDING', 'OVERDUE']);

/**
 * Void a posted vendor bill: reverse its posting journal entry, unwind any
 * inventory it booked directly, and mark it VOID.
 *
 * Only posted, unsettled bills can be voided. PO-sourced bills (`poId` set)
 * leave inventory untouched — the cost layer belongs to the goods receipt, not
 * the invoice; un-receiving is a separate flow.
 *
 * The reversal is dated `date` (the void date) and guarded against closed/locked
 * periods. VOID is terminal.
 */
export async function voidBill(
  tx: Tx,
  orgId: string,
  billId: string,
  opts: { date: Date },
): Promise<void> {
  const bill = await tx.bill.findFirst({
    where: { id: billId, organizationId: orgId },
    select: {
      id: true,
      number: true,
      status: true,
      poId: true,
      journalEntryId: true,
      voidedAt: true,
      deletedAt: true,
      paymentAllocations: { select: { id: true } },
    },
  });

  if (!bill || bill.deletedAt) {
    throw new ApiError('Bill not found', 404);
  }
  if (bill.status === 'VOID' || bill.voidedAt) {
    throw new ApiError('Bill is already voided', 422);
  }
  if (bill.status === 'DRAFT') {
    throw new ApiError('Draft bills are not posted — delete the bill instead of voiding', 422);
  }
  if (bill.status === 'PAID') {
    throw new ApiError('Cannot void a paid bill — void or unallocate its payments first', 422);
  }
  if (bill.paymentAllocations.length > 0) {
    throw new ApiError('Cannot void a bill with payments applied — unallocate its payments first', 422);
  }
  if (!VOIDABLE_STATUSES.has(bill.status)) {
    throw new ApiError(`Cannot void a bill in status ${bill.status}`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);

  // Resolve the posting entry. Bills posted before journalEntryId was tracked
  // fall back to the deterministic memo `Bill: <number>`.
  let journalEntryId = bill.journalEntryId;
  if (!journalEntryId) {
    const original = await tx.journalEntry.findFirst({
      where: { organizationId: orgId, memo: `Bill: ${bill.number}` },
      select: { id: true },
    });
    journalEntryId = original?.id ?? null;
  }
  if (!journalEntryId) {
    throw new ApiError('No posting journal entry found for this bill — nothing to reverse', 422);
  }

  await reverseJournalEntry(tx, journalEntryId, { date: opts.date, memo: `Void bill: ${bill.number}` });

  // Only bills that booked inventory directly own their cost layers. PO-sourced
  // bills cleared GR/IR without creating layers, so leave inventory alone.
  if (!bill.poId) {
    await reversePurchaseLayers(tx, orgId, bill.id, opts.date);
  }

  await tx.bill.update({
    where: { id: bill.id },
    data: { status: 'VOID', voidedAt: opts.date },
  });
}
