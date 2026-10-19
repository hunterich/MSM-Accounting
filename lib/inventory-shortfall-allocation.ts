import { Prisma } from '@prisma/client'

export type EstimatedShortfall = {
  id: string
  quantity: string
  estimatedValue: string
  settledQuantity: string
  settledEstimatedValue: string
}

function decimal(value: string, scale: number) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value)) throw new Error('Invalid nonnegative inventory decimal')
  return new Prisma.Decimal(value)
}
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

/** Pure receipt proposal. Caller orders outstanding estimates oldest-first and
 * holds the warehouse/item lock before applying it. Never changes sale costs.
 * Cumulative rounding closes each original estimate and receipt exactly.
 */
export function allocateShortfallReceipt(quantity: string, value: string, shortfalls: readonly EstimatedShortfall[]) {
  const receiptQuantity = decimal(quantity, 4), receiptValue = decimal(value, 2)
  if (!receiptQuantity.gt(0)) throw new Error('Receipt quantity must be positive')
  let usedQuantity = new Prisma.Decimal(0), usedValue = new Prisma.Decimal(0)
  const ids = new Set<string>()
  const allocations: Array<{ shortfallId: string; quantity: string; estimatedValue: string; actualValue: string; cogsAdjustment: string }> = []
  for (const row of shortfalls) {
    if (!row.id || ids.has(row.id)) throw new Error('Shortfall IDs must be unique and nonempty')
    ids.add(row.id)
    const originalQuantity = decimal(row.quantity, 4), originalValue = decimal(row.estimatedValue, 2)
    const settledQuantity = decimal(row.settledQuantity, 4), settledValue = decimal(row.settledEstimatedValue, 2)
    if (!originalQuantity.gt(0) || settledQuantity.gt(originalQuantity) || settledValue.gt(originalValue) ||
      !settledValue.equals(money(originalValue.mul(settledQuantity).div(originalQuantity)))) {
      throw new Error('Shortfall settlement requires reconciliation')
    }
    const take = Prisma.Decimal.min(originalQuantity.minus(settledQuantity), receiptQuantity.minus(usedQuantity))
    if (!take.gt(0)) continue
    const estimate = money(originalValue.mul(settledQuantity.plus(take)).div(originalQuantity)).minus(settledValue)
    const actual = money(receiptValue.mul(usedQuantity.plus(take)).div(receiptQuantity)).minus(usedValue)
    allocations.push({ shortfallId: row.id, quantity: take.toFixed(4), estimatedValue: estimate.toFixed(2), actualValue: actual.toFixed(2),
      cogsAdjustment: actual.minus(estimate).toFixed(2) })
    usedQuantity = usedQuantity.plus(take); usedValue = usedValue.plus(actual)
  }
  return { allocations, coveredQuantity: usedQuantity.toFixed(4),
    remainingQuantity: receiptQuantity.minus(usedQuantity).toFixed(4), remainingValue: receiptValue.minus(usedValue).toFixed(2),
    cogsAdjustment: allocations.reduce((sum, row) => sum.plus(row.cogsAdjustment), new Prisma.Decimal(0)).toFixed(2) }
}
