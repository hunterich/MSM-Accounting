import { Prisma } from '@prisma/client'
import { allocateInventoryCarryingValue } from './inventory-carrying-allocation'
import { ApiError } from './errors'
import { outstandingShortfallTotals } from './inventory-shortfall-settlement'

/**
 * Read-only proposal for a single costing scope. Call in a repeatable-read,
 * read-only transaction. This is a current-value projection, not a historical
 * backfill and not authorization to persist values or repair discrepancies.
 * A negative pool is accepted only when it equals the tracked, uncovered sale
 * shortage estimates; untracked (legacy) negative stock requires review.
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
  const shortfall = await outstandingShortfallTotals(tx, orgId, itemId, warehouseId)
  if (quantity.isNegative()) {
    if (!physical.isZero() || lots.some(lot => !lot.qtyBalance.isZero()) ||
      !shortfall.quantity.equals(quantity.negated()) || !shortfall.value.equals(value.negated())) {
      throw new ApiError('Cannot propose lot carrying values: negative stock without complete estimated-shortage tracking requires review.', 422)
    }
  } else if (value.isNegative() || lots.some(lot => lot.qtyBalance.isNegative()) || !quantity.equals(physical) || !shortfall.quantity.isZero()) {
    throw new ApiError('Cannot propose lot carrying values: recorded value or quantity requires reconciliation.', 422)
  }
  if (quantity.isZero() && !value.isZero()) {
    throw new ApiError('Cannot propose lot carrying values: inventory has value without quantity.', 422)
  }
  // A tracked shortage has no stock on hand; its lots carry nothing.
  const carried = quantity.isNegative() ? new Prisma.Decimal(0) : value
  const allocation = allocateInventoryCarryingValue(lots.map(lot => ({ id: lot.id, quantity: lot.qtyBalance.toFixed(4) })), carried.toFixed(2))
  const values = new Map(allocation.map(row => [row.id, row.carryingValue]))
  return {
    organizationId: orgId, itemId, warehouseId,
    ledgerQuantity: quantity.toFixed(4), bookValue: value.toFixed(2),
    physicalQuantity: physical.toFixed(4),
    outstandingShortfallQuantity: shortfall.quantity.toFixed(4), outstandingShortfallEstimate: shortfall.value.toFixed(2),
    lots: lots.map(lot => ({ id: lot.id, warehouseId: lot.warehouseId,
      quantity: lot.qtyBalance.toFixed(4), originalReceiptUnitCost: lot.unitCost.toFixed(6),
      proposedCarryingValue: values.get(lot.id)!,
    })),
  }
}
