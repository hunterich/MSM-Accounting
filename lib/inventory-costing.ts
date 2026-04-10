import type { Prisma } from '@prisma/client'
import { InventoryDocumentType } from '@prisma/client'
import { toNumber, asMoney } from './money'

/**
 * Get the costing method configured for an organisation.
 * Defaults to FIFO if none is set.
 */
export async function getOrgCostingMethod(
  tx: Prisma.TransactionClient,
  orgId: string
): Promise<'FIFO' | 'WEIGHTED_AVERAGE'> {
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { costingMethod: true },
  })
  if (org?.costingMethod === 'WEIGHTED_AVERAGE') return 'WEIGHTED_AVERAGE'
  return 'FIFO'
}

/**
 * Add a cost layer (InventoryLot) when goods are received.
 * Also records a corresponding InventoryLedgerEntry for the inbound movement.
 */
export async function addCostLayer(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  unitCost: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date
): Promise<void> {
  await tx.inventoryLot.create({
    data: {
      organizationId: orgId,
      itemId,
      warehouseId: warehouseId ?? null,
      documentType: docType,
      documentId: docId,
      date,
      qtyIn: qty,
      qtyOut: 0,
      qtyBalance: qty,
      unitCost,
    },
  })

  await tx.inventoryLedgerEntry.create({
    data: {
      organizationId: orgId,
      itemId,
      warehouseId: warehouseId ?? null,
      date,
      documentType: docType,
      documentId: docId,
      qtyIn: qty,
      qtyOut: 0,
      unitCost,
      valueChange: asMoney(qty * unitCost),
    },
  })
}

/**
 * FIFO consumption: consumes cost layers oldest-first and returns total cost and
 * average COGS per unit for the outbound movement.
 */
export async function consumeFIFO(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date
): Promise<{ totalCost: number; cogsPerUnit: number }> {
  // Fetch open lots ordered oldest-first (FIFO)
  const lots = await tx.inventoryLot.findMany({
    where: {
      organizationId: orgId,
      itemId,
      ...(warehouseId ? { warehouseId } : {}),
      qtyBalance: { gt: 0 },
    },
    orderBy: { date: 'asc' },
  })

  let remaining = qty
  let totalCost = 0

  for (const lot of lots) {
    if (remaining <= 0) break
    const lotBalance = toNumber(lot.qtyBalance)
    const consume = Math.min(lotBalance, remaining)
    const lotCost = toNumber(lot.unitCost)

    totalCost += consume * lotCost
    remaining -= consume

    await tx.inventoryLot.update({
      where: { id: lot.id },
      data: {
        qtyOut: { increment: consume },
        qtyBalance: { decrement: consume },
      },
    })
  }

  // Safety net: if stock was insufficient, use item's costPrice for the remainder
  if (remaining > 0) {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { costPrice: true },
    })
    const fallbackCost = toNumber(item?.costPrice)
    totalCost += remaining * fallbackCost
  }

  const cogsPerUnit = qty > 0 ? totalCost / qty : 0

  return {
    totalCost: asMoney(totalCost),
    cogsPerUnit: asMoney(cogsPerUnit),
  }
}

/**
 * Calculate the weighted-average unit cost for an item.
 * Returns item.costPrice if no lots exist.
 */
export async function getWeightedAverageCost(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null
): Promise<number> {
  const lots = await tx.inventoryLot.findMany({
    where: {
      organizationId: orgId,
      itemId,
      ...(warehouseId ? { warehouseId } : {}),
      qtyBalance: { gt: 0 },
    },
    select: { qtyBalance: true, unitCost: true },
  })

  if (lots.length === 0) {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { costPrice: true },
    })
    return toNumber(item?.costPrice)
  }

  let totalValue = 0
  let totalQty = 0
  for (const lot of lots) {
    const balance = toNumber(lot.qtyBalance)
    const cost = toNumber(lot.unitCost)
    totalValue += balance * cost
    totalQty += balance
  }

  return totalQty > 0 ? totalValue / totalQty : 0
}

/**
 * High-level function: calculate and post COGS using the organisation's costing
 * method.  Returns the total COGS amount.
 *
 * For FIFO:  calls consumeFIFO which handles lot updates.
 * For WA:    calculates WA cost × qty; decrements lots oldest-first for qty tracking.
 *
 * In both cases an InventoryLedgerEntry is created for the outbound movement.
 */
export async function calculateAndPostCOGS(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
  docType: InventoryDocumentType,
  docId: string,
  date: Date
): Promise<number> {
  const method = await getOrgCostingMethod(tx, orgId)

  let totalCost: number
  let unitCost: number

  if (method === 'FIFO') {
    const result = await consumeFIFO(tx, orgId, itemId, warehouseId, qty, docType, docId, date)
    totalCost = result.totalCost
    unitCost = result.cogsPerUnit
  } else {
    // WEIGHTED_AVERAGE
    unitCost = await getWeightedAverageCost(tx, orgId, itemId, warehouseId)
    totalCost = asMoney(qty * unitCost)

    // Decrement lot balances oldest-first (for qty tracking only, cost is WA)
    const lots = await tx.inventoryLot.findMany({
      where: {
        organizationId: orgId,
        itemId,
        ...(warehouseId ? { warehouseId } : {}),
        qtyBalance: { gt: 0 },
      },
      orderBy: { date: 'asc' },
    })

    let remaining = qty
    for (const lot of lots) {
      if (remaining <= 0) break
      const lotBalance = toNumber(lot.qtyBalance)
      const consume = Math.min(lotBalance, remaining)
      remaining -= consume

      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          qtyOut: { increment: consume },
          qtyBalance: { decrement: consume },
        },
      })
    }
  }

  // Record outbound ledger entry
  await tx.inventoryLedgerEntry.create({
    data: {
      organizationId: orgId,
      itemId,
      warehouseId: warehouseId ?? null,
      date,
      documentType: docType,
      documentId: docId,
      qtyIn: 0,
      qtyOut: qty,
      unitCost,
      valueChange: asMoney(-totalCost),
    },
  })

  return totalCost
}
