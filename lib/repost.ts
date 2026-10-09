import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { reverseJournalEntry } from './reverse-journal-entry';
import { reversePurchaseLayers, restoreConsumedLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

/**
 * Reverse a posted bill's / invoice's GL + inventory side effects so the
 * document can be edited and re-posted within an open period (Accurate-style
 * "edit a posted transaction"). These mirror the reversal cores of
 * `lib/bill-void.ts` / `lib/invoice-void.ts` but do NOT touch document status —
 * the caller reverses, applies the edit, then re-posts in the same transaction,
 * so the document stays OPEN/SENT throughout.
 *
 * KEEP IN SYNC with the void reversals: if bill/invoice posting changes which
 * inventory layers or journal entries it produces, update both this file and the
 * matching `*-void.ts`.
 */

/** Reverse a posted bill's journal entry + (for non-PO bills) its cost layers. */
export async function reverseBillPosting(
  tx: Tx,
  orgId: string,
  bill: { id: string; number: string; poId: string | null; journalEntryId: string | null },
  opts: { date: Date },
): Promise<void> {
  // Resolve the posting entry: tracked journalEntryId, else the deterministic
  // memo `Bill: <number>` (legacy bills posted before the column existed).
  let journalEntryId = bill.journalEntryId;
  if (!journalEntryId) {
    const original = await tx.journalEntry.findFirst({
      where: { organizationId: orgId, memo: `Bill: ${bill.number}`, status: 'POSTED' },
      select: { id: true },
    });
    journalEntryId = original?.id ?? null;
  }
  if (!journalEntryId) {
    throw new ApiError('No posting journal entry found for this bill — nothing to reverse', 422);
  }
  await reverseJournalEntry(tx, journalEntryId, { date: opts.date, memo: `Re-post bill: ${bill.number}` });

  // Only bills that booked inventory directly own cost layers. PO-sourced bills
  // cleared GR/IR without creating layers, so leave inventory alone.
  if (!bill.poId) {
    await reversePurchaseLayers(tx, orgId, bill.id, opts.date);
  }
}

/** Reverse a posted invoice's AR + COGS entries and put the sold stock back. */
export async function reverseInvoicePosting(
  tx: Tx,
  orgId: string,
  inv: { id: string; number: string; postingTracked?: boolean; postingJournalIds?: string[] },
  opts: { date: Date },
): Promise<void> {
  // Restore before journal numbering: shared-item locks must precede the
  // journal lock, matching send/re-post. A failure rolls the transaction back.
  await restoreConsumedLayers(tx, orgId, InventoryDocumentType.SALES, inv.id, opts.date, { requireExact: true });
  const entries = await tx.journalEntry.findMany({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      ...(inv.postingTracked
        ? { id: { in: inv.postingJournalIds ?? [] } }
        : { memo: { in: [`Sales recognition: ${inv.number}`, `COGS auto-post: ${inv.number}`] } }),
    },
    select: { id: true, memo: true },
  });
  if (inv.postingTracked && entries.length !== (inv.postingJournalIds ?? []).length) {
    throw new ApiError('Invoice posting history is incomplete — cannot safely reverse it.', 422);
  }
  if (!inv.postingTracked && entries.filter(entry => entry.memo === `Sales recognition: ${inv.number}`).length > 1) {
    throw new ApiError('Historical invoice has multiple untracked postings — review its journal history before correcting.', 422);
  }
  for (const entry of entries) {
    await reverseJournalEntry(tx, entry.id, { date: opts.date, memo: `Re-post invoice: ${inv.number}` });
  }
}
