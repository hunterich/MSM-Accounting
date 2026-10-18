import type { Prisma, InventoryLot } from '@prisma/client'
import { ApiError } from './errors'

/** Caller holds the sorted item lock. WA can undo an inbound at original value
 * across later receipts, but cannot revise the basis of a later stock issue.
 * Sequence is assigned at insertion under that lock, not at transaction start.
 * Reversed issues and inbound-removal rows (reversedAt set) net to zero in
 * quantity and value, so they no longer depend on this receipt's basis.
 */
export async function assertNoLaterStockIssue(tx: Prisma.TransactionClient, orgId: string, lot: InventoryLot) {
  const inbound = lot.inboundLedgerEntryId ? await tx.inventoryLedgerEntry.findFirst({ where: {
    id: lot.inboundLedgerEntryId, organizationId: orgId, itemId: lot.itemId, warehouseId: lot.warehouseId,
    documentType: lot.documentType, documentId: lot.documentId, qtyIn: { gt: 0 },
  }, select: { postingSequence: true } }) : null
  if (inbound?.postingSequence == null) {
    throw new ApiError('Cannot reverse: original receipt posting order is unavailable. Review the legacy inventory history before reversing this receipt.', 422)
  }
  const issue = await tx.inventoryLedgerEntry.findFirst({ where: {
    organizationId: orgId, itemId: lot.itemId, warehouseId: lot.warehouseId, qtyOut: { gt: 0 },
    postingSequence: { gt: inbound.postingSequence }, reversedAt: null,
    NOT: { documentType: lot.documentType, documentId: lot.documentId },
  }, orderBy: { postingSequence: 'asc' }, select: { documentType: true, documentId: true, date: true } })
  if (!issue) return
  const where = { id: issue.documentId, organizationId: orgId }, select = { number: true as const }
  const document = issue.documentType === 'SALES' ? await tx.salesInvoice.findFirst({ where, select })
    : issue.documentType === 'PURCHASE_RETURN' ? await tx.purchaseReturn.findFirst({ where, select })
    : issue.documentType === 'ADJUSTMENT' ? await tx.stockAdjustment.findFirst({ where, select }) : null
  // Legacy void rows reuse the voided document's ID under ADJUSTMENT; a raw ID
  // means nothing to users, so fall back to the movement's business date.
  const label = document ? `${issue.documentType} ${document.number}` : `stock movement dated ${issue.date.toISOString().slice(0, 10)}`
  throw new ApiError(`Cannot reverse: later ${label} issued stock from this item's warehouse after this receipt. Reverse or review that stock issue first.`, 422)
}
