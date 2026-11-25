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
 * Voids and edits of a non-zero posted invoice require its own sales posting.
 * Migrated opening invoices get their receivable from the opening journal.
 * Refuse to change their documents, or invoices that skipped AR posting,
 * so a reviewer can reconcile the receivable before a correction.
 */
export function assertInvoiceSalesPosting(inv: InvoicePostingRef, entries: Array<{ memo: string }>, action: 'void' | 'edit' | 'edit notes'): void {
  // Tracked ids are authoritative for what the invoice posted; only COGS
  // entries alone mean the receivable was never booked. Untracked history is
  // found by memo, so it needs the recognition memo itself.
  const hasSalesPosting = inv.postingTracked
    ? entries.some(entry => entry.memo !== `COGS auto-post: ${inv.number}`)
    : entries.some(entry => entry.memo === `Sales recognition: ${inv.number}`);
  if (toNumber(inv.totalAmount) === 0 || hasSalesPosting) return;
  const effect = {
    void: 'Voiding it would leave its receivable in the general ledger',
    edit: 'Editing it would post its amount a second time',
    'edit notes': 'Notes edits require the original sales posting',
  }[action];
  throw new ApiError(`Invoice ${inv.number} has no sales posting to reverse (for example a migrated opening balance). ${effect}; record a reviewed correction with finance instead.`, 422);
}
