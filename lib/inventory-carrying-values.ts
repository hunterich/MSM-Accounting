import type { Prisma } from '@prisma/client'
import { previewInventoryCarryingValues } from './inventory-carrying-preview'

/** Caller holds the item lock; value allocation adds no ledger or GL movement. */
export async function refreshWarehouseCarryingValues(
  tx: Prisma.TransactionClient, orgId: string, itemId: string, warehouseId: string | null,
) {
  const proposal = await previewInventoryCarryingValues(tx, orgId, itemId, warehouseId)
  for (const lot of proposal.lots) {
    await tx.inventoryLot.update({ where: { id: lot.id }, data: { carryingValue: lot.proposedCarryingValue } })
  }
}
