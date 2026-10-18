import type { Prisma, InventoryLot, InventoryDocumentType } from '@prisma/client'
import { ApiError } from './errors'

/** Caller holds the sorted item lock. WA can undo an inbound at original value
 * across later receipts, but cannot revise the basis of a later stock issue.
 * Sequence is assigned at insertion under that lock, not at transaction start.
 *
 * Two later outbound kinds leave the pool exactly as if they never happened, so
 * they never block: an issue whose stock was fully restored by its own void
 * (linked restore row, or a legacy sale marked reversedAt), and the removal row
 * of another inbound void (linked to the inbound it removed, which passed this
 * same guard). Unlinked legacy rows still block rather than guess provenance.
 */
export async function assertNoLaterStockIssue(tx: Prisma.TransactionClient, orgId: string, lot: InventoryLot) {
  const inbound = lot.inboundLedgerEntryId ? await tx.inventoryLedgerEntry.findFirst({ where: {
    id: lot.inboundLedgerEntryId, organizationId: orgId, itemId: lot.itemId, warehouseId: lot.warehouseId,
    documentType: lot.documentType, documentId: lot.documentId, qtyIn: { gt: 0 },
  }, select: { postingSequence: true } }) : null
  if (inbound?.postingSequence == null) {
    throw new ApiError('Cannot reverse: original receipt posting order is unavailable. Review the legacy inventory history before reversing this receipt.', 422)
  }
  const [issue] = await tx.$queryRaw<Array<{ documentType: InventoryDocumentType; documentId: string; date: Date }>>`
    SELECT e."documentType", e."documentId", e."date"
    FROM "InventoryLedgerEntry" e
    WHERE e."organizationId" = ${orgId} AND e."itemId" = ${lot.itemId}
      AND e."warehouseId" IS NOT DISTINCT FROM ${lot.warehouseId}
      AND e."qtyOut" > 0 AND e."postingSequence" > ${inbound.postingSequence}
      AND NOT (e."documentType"::text = ${lot.documentType} AND e."documentId" = ${lot.documentId})
      AND e."reversesLedgerEntryId" IS NULL AND e."reversedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "InventoryLedgerEntry" r
        WHERE r."organizationId" = e."organizationId" AND r."reversesLedgerEntryId" = e."id")
    ORDER BY e."postingSequence" ASC
    LIMIT 1
  `
  if (!issue) return
  const where = { id: issue.documentId, organizationId: orgId }, select = { number: true as const }
  const document = issue.documentType === 'SALES' ? await tx.salesInvoice.findFirst({ where, select })
    : issue.documentType === 'PURCHASE_RETURN' ? await tx.purchaseReturn.findFirst({ where, select })
    : issue.documentType === 'ADJUSTMENT' ? await tx.stockAdjustment.findFirst({ where, select }) : null
  const label = document
    ? `${issue.documentType} ${document.number}`
    : `stock movement dated ${issue.date.toISOString().slice(0, 10)}`
  throw new ApiError(`Cannot reverse: later ${label} issued stock from this item's warehouse after this receipt. Reverse or review that stock issue first.`, 422)
}
