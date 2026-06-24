import type { Prisma } from '@prisma/client'
import { InventoryDocumentType } from '@prisma/client'
import { toNumber, asMoney } from './money'
import { ApiError } from './errors'

const QTY_EPSILON = 1e-6

/**
 * Total on-hand quantity for an item (optionally scoped to a warehouse),
 * summed from open cost layers.
 */
async function getAvailableQty(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
): Promise<number> {
  const lots = await tx.inventoryLot.findMany({
    where: {
      organizationId: orgId,
      itemId,
      ...(warehouseId ? { warehouseId } : {}),
      qtyBalance: { gt: 0 },
    },
    select: { qtyBalance: true },
  })
  return lots.reduce((sum, lot) => sum + toNumber(lot.qtyBalance), 0)
}

/**
 * Guard against overselling. Throws unless the org has opted into negative
 * stock. Without this, an outbound movement that exceeds on-hand silently
 * falls back to `item.costPrice`, producing negative real stock and a
 * guessed COGS — quietly misstating both the inventory asset and margin.
 */
async function assertSufficientStock(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  qty: number,
): Promise<void> {
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { allowNegativeStock: true },
  })
  if (org?.allowNegativeStock) return

  const available = await getAvailableQty(tx, orgId, itemId, warehouseId)
  if (qty > available + QTY_EPSILON) {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { sku: true, name: true },
    })
    const label = item ? `${item.sku} — ${item.name}` : itemId
    throw new ApiError(
      `Insufficient stock for ${label}: requested ${qty}, available ${available}. ` +
        `Receive more stock or enable "allow negative stock" in Settings.`,
      422,
    )
  }
}

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
 * Reverse the inbound cost layers a document booked under a given documentType
 * (e.g. PURCHASE layers from a bill, SALES_RETURN restock layers from a sales
 * return, ADJUSTMENT layers from a stock-increase). Only whole, untouched layers
 * can be removed: if any layer has been drawn down (consumed/sold), reversal is
 * impossible without reconstructing FIFO history, so it throws and the caller
 * must block the void.
 *
 * On success each layer is deleted and a contra `InventoryLedgerEntry`
 * (ADJUSTMENT, negative valueChange) is appended for the audit trail. Returns
 * the total cost value removed (so callers can post the balancing GL contra).
 *
 * Not idempotent: the caller is responsible for guarding against double-reversal
 * at the document level (e.g. a terminal VOID status).
 */
export async function reverseAddedLayers(
  tx: Prisma.TransactionClient,
  orgId: string,
  documentType: InventoryDocumentType,
  documentId: string,
  date: Date,
): Promise<number> {
  const lots = await tx.inventoryLot.findMany({
    where: { organizationId: orgId, documentType, documentId },
  })
  if (lots.length === 0) return 0

  for (const lot of lots) {
    if (Math.abs(toNumber(lot.qtyBalance) - toNumber(lot.qtyIn)) > QTY_EPSILON) {
      throw new ApiError(
        'Cannot reverse: inventory added by this document has already been consumed or sold. Reverse the dependent transactions first.',
        422,
      )
    }
  }

  let valueRemoved = 0
  for (const lot of lots) {
    const qty = toNumber(lot.qtyIn)
    const unitCost = toNumber(lot.unitCost)
    const value = asMoney(qty * unitCost)
    valueRemoved += value
    await tx.inventoryLedgerEntry.create({
      data: {
        organizationId: orgId,
        itemId: lot.itemId,
        warehouseId: lot.warehouseId ?? null,
        date,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId,
        qtyIn: 0,
        qtyOut: qty,
        unitCost,
        valueChange: -value,
      },
    })
    await tx.inventoryLot.delete({ where: { id: lot.id } })
  }
  return asMoney(valueRemoved)
}

/**
 * Back-compat wrapper: reverse the PURCHASE cost layers a bill / goods receipt
 * booked. Delegates to {@link reverseAddedLayers} with documentType PURCHASE.
 */
export function reversePurchaseLayers(
  tx: Prisma.TransactionClient,
  orgId: string,
  documentId: string,
  date: Date,
): Promise<number> {
  return reverseAddedLayers(tx, orgId, InventoryDocumentType.PURCHASE, documentId, date)
}

/**
 * Un-consume: restore the stock a document drew down (e.g. when voiding an
 * invoice's COGS or a purchase return's removal). For each outbound
 * `InventoryLedgerEntry` the document wrote, re-add a fresh inbound cost layer +
 * ledger entry. The restored value anchors on the recorded `valueChange` (the
 * exact total removed), so the round-trip is value-neutral even when the
 * per-unit cost was rounded; the re-derived `unitCost` keeps the new lot's value
 * equal to that total (so the inventory ledger and lots stay reconciled).
 *
 * The re-added layer is tagged ADJUSTMENT and dated `date`, so it re-enters FIFO
 * at the end of the queue — a documented, accepted simplification vs. exact-lot
 * restoration. Returns the total value restored (so callers can post the
 * balancing GL contra).
 *
 * Not idempotent: the caller guards against double-restore at the document level
 * (a terminal VOID status).
 */
export async function restoreConsumedLayers(
  tx: Prisma.TransactionClient,
  orgId: string,
  documentType: InventoryDocumentType,
  documentId: string,
  date: Date,
): Promise<number> {
  const outbound = await tx.inventoryLedgerEntry.findMany({
    where: { organizationId: orgId, documentType, documentId, qtyOut: { gt: 0 } },
  })
  if (outbound.length === 0) return 0

  let valueRestored = 0
  for (const entry of outbound) {
    const qty = toNumber(entry.qtyOut)
    const value = asMoney(-toNumber(entry.valueChange)) // exact total removed
    const unitCost = qty > 0 ? value / qty : 0
    valueRestored += value

    await tx.inventoryLot.create({
      data: {
        organizationId: orgId,
        itemId: entry.itemId,
        warehouseId: entry.warehouseId ?? null,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId,
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
        itemId: entry.itemId,
        warehouseId: entry.warehouseId ?? null,
        date,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId,
        qtyIn: qty,
        qtyOut: 0,
        unitCost,
        valueChange: value,
      },
    })
  }
  return asMoney(valueRestored)
}

/**
 * Reverse the inventory a stock adjustment moved. An adjustment can move stock
 * BOTH ways under one `(ADJUSTMENT, documentId)` key — increases added layers,
 * decreases drew layers down — so the generic `reverseAddedLayers` /
 * `restoreConsumedLayers` can't be composed here: each writes ADJUSTMENT-keyed
 * rows that the other would then re-read, double-counting.
 *
 * This does the unwind in a single snapshot-first pass: it reads the adjustment's
 * own ledger movements up front, then removes the increase layers (blocking if
 * any was since consumed) and re-adds the decrease draw-downs at recorded cost.
 * Because the originals are snapshotted before any contra/restore row is written,
 * the reversal rows are never re-processed. Returns the net value reversed.
 */
export async function reverseAdjustmentInventory(
  tx: Prisma.TransactionClient,
  orgId: string,
  documentId: string,
  date: Date,
): Promise<number> {
  // Snapshot the adjustment's original outbound (decrease) movements first.
  const outbound = (
    await tx.inventoryLedgerEntry.findMany({
      where: { organizationId: orgId, documentType: InventoryDocumentType.ADJUSTMENT, documentId },
    })
  ).filter((e) => toNumber(e.qtyOut) > 0)

  // The increase layers this adjustment added.
  const addedLots = await tx.inventoryLot.findMany({
    where: { organizationId: orgId, documentType: InventoryDocumentType.ADJUSTMENT, documentId },
  })
  for (const lot of addedLots) {
    if (Math.abs(toNumber(lot.qtyBalance) - toNumber(lot.qtyIn)) > QTY_EPSILON) {
      throw new ApiError(
        'Cannot void: stock added by this adjustment has already been consumed or sold. Reverse the dependent transactions first.',
        422,
      )
    }
  }

  let netReversed = 0

  // Remove the increases (delete the layer, append a contra ledger row).
  for (const lot of addedLots) {
    const qty = toNumber(lot.qtyIn)
    const unitCost = toNumber(lot.unitCost)
    const value = asMoney(qty * unitCost)
    netReversed -= value
    await tx.inventoryLedgerEntry.create({
      data: {
        organizationId: orgId,
        itemId: lot.itemId,
        warehouseId: lot.warehouseId ?? null,
        date,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId,
        qtyIn: 0,
        qtyOut: qty,
        unitCost,
        valueChange: -value,
      },
    })
    await tx.inventoryLot.delete({ where: { id: lot.id } })
  }

  // Restore the decreases (re-add a layer at the recorded consumed cost).
  for (const entry of outbound) {
    const qty = toNumber(entry.qtyOut)
    const value = asMoney(-toNumber(entry.valueChange))
    const unitCost = qty > 0 ? value / qty : 0
    netReversed += value
    await tx.inventoryLot.create({
      data: {
        organizationId: orgId,
        itemId: entry.itemId,
        warehouseId: entry.warehouseId ?? null,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId,
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
        itemId: entry.itemId,
        warehouseId: entry.warehouseId ?? null,
        date,
        documentType: InventoryDocumentType.ADJUSTMENT,
        documentId,
        qtyIn: qty,
        qtyOut: 0,
        unitCost,
        valueChange: value,
      },
    })
  }

  return asMoney(netReversed)
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
 * Relieve cost layers for an outbound movement using the org's costing method
 * (FIFO oldest-first, or weighted-average), write the outbound InventoryLedgerEntry,
 * and return the total cost removed.
 *
 * NOTE: this does NOT guard against insufficient stock — callers that need the
 * oversell guard (sales) run assertSufficientStock first via calculateAndPostCOGS.
 * Callers that are corrections (stock adjustments) relieve what exists and value
 * any shortfall at item.costPrice (consumeFIFO's fallback).
 */
export async function relieveCostLayers(
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

/**
 * High-level function: calculate and post COGS using the organisation's costing
 * method.  Returns the total COGS amount.  Guards against overselling, then
 * relieves cost layers via relieveCostLayers.
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
  await assertSufficientStock(tx, orgId, itemId, warehouseId, qty)
  return relieveCostLayers(tx, orgId, itemId, warehouseId, qty, docType, docId, date)
}
