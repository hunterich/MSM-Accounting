import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { restoreConsumedLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

const VOIDABLE_STATUSES = new Set(['SENT', 'OVERDUE']);

/**
 * Void a posted sales invoice: reverse its AR-recognition and COGS journal
 * entries, put the sold stock back, and mark it VOID.
 *
 * Invoices have no journalEntryId column, so the posting entries are resolved by
 * their deterministic memos — `Sales recognition: <number>` (one) and
 * `COGS auto-post: <number>` (one per inventory line). The reversal is dated at
 * the void date and period-guarded. VOID is terminal.
 *
 * Reversing the COGS entry restores the inventory asset in the GL;
 * `restoreConsumedLayers` restores the perpetual inventory subledger by the same
 * amount, so the two stay reconciled without any new balancing post.
 *
 * Refuses draft/pending (not posted — delete instead), already-void, paid, and
 * receipt-allocated invoices (unallocate the receipts first).
 */
export async function voidInvoice(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  opts: { date: Date },
): Promise<void> {
  const inv = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      id: true,
      number: true,
      status: true,
      paymentAllocations: { select: { id: true } },
    },
  });

  if (!inv) {
    throw new ApiError('Invoice not found', 404);
  }
  if (inv.status === 'VOID') {
    throw new ApiError('Invoice is already voided', 422);
  }
  if (inv.status === 'DRAFT' || inv.status === 'PENDING_APPROVAL') {
    throw new ApiError('Draft invoices are not posted — delete the invoice instead of voiding', 422);
  }
  if (inv.status === 'PAID') {
    throw new ApiError('Cannot void a paid invoice — void its receipts first', 422);
  }
  if (inv.paymentAllocations.length > 0) {
    throw new ApiError('Cannot void an invoice with receipts applied — unallocate them first', 422);
  }
  if (!VOIDABLE_STATUSES.has(inv.status)) {
    throw new ApiError(`Cannot void an invoice in status ${inv.status}`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);

  // Atomically claim VOID before any GL/inventory side effect. The guarded
  // `updateMany` takes a row lock; a concurrent void blocks here, then sees the
  // invoice already VOID → count 0 → 409, so the reversal + restock run exactly
  // once and the ledger/inventory can never be double-reversed.
  const claim = await tx.salesInvoice.updateMany({
    where: { id: inv.id, organizationId: orgId, status: { not: 'VOID' } },
    data: { status: 'VOID' },
  });
  if (claim.count !== 1) {
    throw new ApiError('Invoice is already voided', 409);
  }

  // Reverse the AR-recognition + COGS posting entries (resolved by memo — no
  // journalEntryId column on invoices; there is one COGS entry per inventory line).
  const entries = await tx.journalEntry.findMany({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      memo: { in: [`Sales recognition: ${inv.number}`, `COGS auto-post: ${inv.number}`] },
    },
    select: { id: true },
  });
  for (const entry of entries) {
    await reverseJournalEntry(tx, entry.id, { date: opts.date, memo: `Void invoice: ${inv.number}` });
  }

  // Put the sold stock back (un-consume the SALES draw-down).
  await restoreConsumedLayers(tx, orgId, InventoryDocumentType.SALES, inv.id, opts.date);
}
