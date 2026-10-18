import type { Prisma } from '@prisma/client'
import { ApiError } from './errors'
import { lockInventoryItems } from './inventory-costing'
import { refreshWarehouseCarryingValues } from './inventory-carrying-values'
import { assertPeriodOpen } from './period-guard'
import type { TransactionDateGuardOptions } from './transaction-date-policy'

/** Prospective method change, preserving book value and receipt identities. */
export async function changeInventoryCostingMethod(
  tx: Prisma.TransactionClient, orgId: string, method: 'FIFO' | 'WEIGHTED_AVERAGE',
  effectiveDate: Date, opts: TransactionDateGuardOptions = {},
) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE`
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { costingMethod: true } })
  if (!org) throw new ApiError('Organization not found', 404)
  if (org.costingMethod === method) throw new ApiError(`Organization is already using ${method}`, 422)
  await assertPeriodOpen(tx, orgId, effectiveDate, opts)
  const items = await tx.item.findMany({ where: { organizationId: orgId }, select: { id: true } })
  await lockInventoryItems(tx, orgId, items.map(item => item.id))
  const lots = await tx.inventoryLot.findMany({ where: { organizationId: orgId }, select: { itemId: true, warehouseId: true, qtyBalance: true } })
  const movements = await tx.inventoryLedgerEntry.groupBy({ by: ['itemId', 'warehouseId'], where: { organizationId: orgId } })
  const scopes = new Map<string, { itemId: string; warehouseId: string | null }>()
  for (const row of [...lots, ...movements]) scopes.set(`${row.itemId}:${row.warehouseId ?? ''}`, { itemId: row.itemId, warehouseId: row.warehouseId })
  for (const scope of scopes.values()) await refreshWarehouseCarryingValues(tx, orgId, scope.itemId, scope.warehouseId)
  await tx.organization.update({ where: { id: orgId }, data: { costingMethod: method,
    costingMethodSetAt: new Date(), costingMethodEffectiveDate: effectiveDate } })
  return { oldMethod: org.costingMethod, itemsRecalculated: new Set(lots.filter(lot => Number(lot.qtyBalance) > 0).map(lot => lot.itemId)).size,
    totalValueChange: 0, journalEntryId: null }
}
