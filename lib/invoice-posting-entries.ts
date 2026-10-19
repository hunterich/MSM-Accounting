import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { toNumber } from './money';

type Tx = Prisma.TransactionClient;

export interface InvoicePostingRef {
  number: string;
  totalAmount: unknown;
  postingTracked?: boolean;
  postingJournalIds?: string[];
}

/** Posted AR-recognition and COGS entries of an invoice: tracked ids, else the legacy memos. */
export function findInvoicePostingEntries(tx: Tx, orgId: string, inv: InvoicePostingRef) {
  return tx.journalEntry.findMany({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      ...(inv.postingTracked
        ? { id: { in: inv.postingJournalIds ?? [] } }
        : { memo: { in: [`Sales recognition: ${inv.number}`, `COGS auto-post: ${inv.number}`] } }),
    },
    select: { id: true, memo: true },
  });
}

/**
 * A non-zero invoice can only be voided or edited by reversing its own sales
 * posting. Migrated opening invoices have none (the opening journal holds their
 * receivable), and a send that skipped AR posting left none: reversing nothing
 * would leave the receivable in the GL on void, or post it again on edit. How to
 * correct those is a finance decision, so refuse rather than guess.
 */
export function assertInvoiceSalesPosting(inv: InvoicePostingRef, entries: Array<{ memo: string }>, action: 'void' | 'edit'): void {
  // Tracked ids are authoritative for what the invoice posted; only COGS
  // entries alone mean the receivable was never booked. Untracked history is
  // found by memo, so it needs the recognition memo itself.
  const hasSalesPosting = inv.postingTracked
    ? entries.some(entry => entry.memo !== `COGS auto-post: ${inv.number}`)
    : entries.some(entry => entry.memo === `Sales recognition: ${inv.number}`);
  if (toNumber(inv.totalAmount) === 0 || hasSalesPosting) return;
  const effect = action === 'void' ? 'Voiding it would leave its receivable in the general ledger' : 'Editing it would post its amount a second time';
  throw new ApiError(`Invoice ${inv.number} has no sales posting to reverse (for example a migrated opening balance). ${effect}; record a reviewed correction with finance instead.`, 422);
}
