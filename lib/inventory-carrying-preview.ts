import { Prisma } from '@prisma/client'
import { allocateInventoryCarryingValue } from './inventory-carrying-allocation'
import { ApiError } from './errors'

/**
 * Read-only proposal for a single costing scope. Call in a repeatable-read,
 * read-only transaction. This is a current-value projection, not a historical
 * backfill and not authorization to persist values or repair discrepancies.
 */
export async function previewInventoryCarryingValues(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
) {
  const where = { organizationId: orgId, itemId, warehouseId }
  const pool = await tx.inventoryLedgerEntry.aggregate({ where, _sum: { qtyIn: true, qtyOut: true, valueChange: true } })
  const lots = await tx.inventoryLot.findMany({ where, orderBy: { id: 'asc' }, select: {
    id: true, warehouseId: true, qtyBalance: true, unitCost: true,
  } })
  const quantity = new Prisma.Decimal(pool._sum.qtyIn ?? 0).minus(pool._sum.qtyOut ?? 0)
  const value = new Prisma.Decimal(pool._sum.valueChange ?? 0)
  const physical = lots.reduce((sum, lot) => sum.plus(lot.qtyBalance), new Prisma.Decimal(0))
  if (quantity.isNegative() || value.isNegative() || lots.some(lot => lot.qtyBalance.isNegative()) || !quantity.equals(physical)) {
    throw new ApiError('Cannot propose lot carrying values: recorded value or quantity requires reconciliation.', 422)
  }
  if (quantity.isZero() && !value.isZero()) {
    throw new ApiError('Cannot propose lot carrying values: inventory has value without quantity.', 422)
  }
  const allocation = allocateInventoryCarryingValue(lots.map(lot => ({ id: lot.id, quantity: lot.qtyBalance.toFixed(4) })), value.toFixed(2))
  const values = new Map(allocation.map(row => [row.id, row.carryingValue]))
  return {
    organizationId: orgId, itemId, warehouseId,
    ledgerQuantity: quantity.toFixed(4), bookValue: value.toFixed(2),
    physicalQuantity: physical.toFixed(4),
    lots: lots.map(lot => ({ id: lot.id, warehouseId: lot.warehouseId,
      quantity: lot.qtyBalance.toFixed(4), originalReceiptUnitCost: lot.unitCost.toFixed(6),
      proposedCarryingValue: values.get(lot.id)!,
    })),
  }
}
