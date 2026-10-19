/**
 * Distribute a Weighted Average pool's booked value across its physical lots.
 * Quantity weights use the database's four decimal places. Value uses integer
 * cents throughout, preserving receipt prices and avoiding floating-point loss.
 * This only allocates carrying value; it never changes the pool's book value.
 */
export type CarryingLot = { id: string; quantity: string }
export type CarryingAllocation = { id: string; carryingValue: string }

function units(value: string, scale: number, precision: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Expected a nonnegative decimal')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > scale) throw new Error('Decimal exceeds database scale')
  const result = BigInt(whole + fraction.padEnd(scale, '0'))
  if (result >= 10n ** BigInt(precision)) throw new Error('Decimal exceeds database precision')
  return result
}

function money(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}

function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }

export function allocateInventoryCarryingValue(
  lots: readonly CarryingLot[],
  bookValue: string,
): CarryingAllocation[] {
  const totalCents = units(bookValue, 2, 18)
  const ids = new Set<string>()
  const rows = lots.map(lot => {
    if (!lot.id || ids.has(lot.id)) throw new Error('Lot identifiers must be unique and nonempty')
    ids.add(lot.id)
    return { id: lot.id, quantity: units(lot.quantity, 4, 15), cents: 0n, remainder: 0n }
  })
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0n)
  if (totalQuantity === 0n) {
    if (totalCents !== 0n) throw new Error('Inventory value cannot be allocated without stock')
  } else {
    for (const row of rows) {
      const numerator = totalCents * row.quantity
      row.cents = numerator / totalQuantity
      row.remainder = numerator % totalQuantity
    }
    let residual = totalCents - rows.reduce((sum, row) => sum + row.cents, 0n)
    // Largest fractional remainders receive residual cents; IDs break ties.
    // Sorting makes the allocation stable across query/cart ordering and retries.
    const ranked = rows.filter(row => row.quantity > 0n).sort((a, b) =>
      a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : compareId(a.id, b.id))
    for (const row of ranked) {
      if (residual === 0n) break
      row.cents += 1n
      residual -= 1n
    }
    if (residual !== 0n) throw new Error('Inventory carrying allocation did not conserve value')
  }
  return rows.sort((a, b) => compareId(a.id, b.id)).map(row => ({ id: row.id, carryingValue: money(row.cents) }))
}
