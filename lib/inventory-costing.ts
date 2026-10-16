import type { Prisma } from '@prisma/client'
import { InventoryDocumentType } from '@prisma/client'
import { toNumber, asMoney } from './money'
import { ApiError } from './errors'
import { advisoryLockKey } from './advisory-lock'
import { refreshWarehouseCarryingValues } from './inventory-carrying-values'
import { allocateInventoryCarryingValue } from './inventory-carrying-allocation'
import { assertNoLaterStockIssue } from './inventory-inbound-reversal'

const QTY_EPSILON = 1e-6
type TrackedMovement = Prisma.InventoryLedgerEntryGetPayload<{ include: { lotDraws: { include: { lot: true } } } }>

function canRestoreExactSalesValue(entry: TrackedMovement, orgId: string): boolean {
  return entry.documentType === 'SALES' && entry.drawsTracked && entry.lotDraws.length > 0 &&
    entry.lotDraws.every(draw => draw.lot && draw.lot.organizationId === orgId && draw.lot.itemId === entry.itemId) &&
    Math.abs(entry.lotDraws.reduce((sum, draw) => sum + toNumber(draw.quantity), 0) - toNumber(entry.qtyOut)) <= QTY_EPSILON &&
    Math.abs(asMoney(entry.lotDraws.reduce((sum, draw) => sum + (draw.costValue != null ? toNumber(draw.costValue) : toNumber(draw.quantity) * toNumber(draw.lot?.unitCost)), 0)) + toNumber(entry.valueChange)) <= 0.01
}

/** Corrections must leave a sale that can also be reversed at its recorded cost. */
export async function assertCorrectedSalesValue(tx: Prisma.TransactionClient, orgId: string, invoiceId: string) {
  const entries = await tx.inventoryLedgerEntry.findMany({
    where: { organizationId: orgId, documentType: 'SALES', documentId: invoiceId, reversedAt: null, qtyOut: { gt: 0 } },
    include: { lotDraws: { include: { lot: true } } },
  })
  if (entries.some(entry => !canRestoreExactSalesValue(entry, orgId))) {
    throw new ApiError('The corrected sale cost differs from its stock-lot value — void and replace the invoice instead.', 422)
  }
}

/** Use one global item order before journal numbering or inventory writes. */
export async function lockInventoryItems(tx: Prisma.TransactionClient, orgId: string, itemIds: readonly string[]) {
  // Pin configuration before items; method changes take this row FOR UPDATE.
  await tx.$executeRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR SHARE`
  for (const itemId of [...new Set(itemIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`item-stock:${orgId}:${itemId}`)})`
  }
}

/**
 * Total on-hand quantity for an item (optionally scoped to a warehouse),
 * summed from open cost layers.
 */
async function getAvailableQty(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null,
  fulfillAcrossWarehouses = false,
): Promise<number> {
  const lots = await tx.inventoryLot.findMany({
    where: {
      organizationId: orgId,
      itemId,
      ...(!warehouseId && fulfillAcrossWarehouses ? {} : { warehouseId }),
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
  allowNegativeStockOverride = false,
  fulfillAcrossWarehouses = false,
): Promise<void> {
  if (allowNegativeStockOverride) return
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { allowNegativeStock: true },
  })
  if (org?.allowNegativeStock) return

  const available = await getAvailableQty(tx, orgId, itemId, warehouseId, fulfillAcrossWarehouses)
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
  date: Date,
  bookedValue?: number,
): Promise<void> {
  await lockInventoryItems(tx, orgId, [itemId])
  // A rounded unit price cannot reconstruct every exact document line value.
  const initialValue = asMoney(bookedValue ?? qty * unitCost)
  const inbound = await tx.inventoryLedgerEntry.create({ data: {
    organizationId: orgId, itemId, warehouseId: warehouseId ?? null, date,
    documentType: docType, documentId: docId, qtyIn: qty, qtyOut: 0, unitCost, valueChange: initialValue,
  }, select: { id: true } })
  await tx.inventoryLot.create({
    data: {
      inboundLedgerEntryId: inbound.id,
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
      initialValue,
      carryingValue: initialValue,
    },
  })

  if (await getOrgCostingMethod(tx, orgId) === 'WEIGHTED_AVERAGE') {
    await refreshWarehouseCarryingValues(tx, orgId, itemId, warehouseId)
  }
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
  // Discover identities before waiting, then inspect quantities under the
  // shared item locks. A concurrent sale must not consume a checked layer
  // while this reversal waits to delete it.
  const identities = await tx.inventoryLot.findMany({
    where: { organizationId: orgId, documentType, documentId },
    select: { itemId: true },
  })
  await lockInventoryItems(tx, orgId, identities.map(lot => lot.itemId))
  const lots = await tx.inventoryLot.findMany({
    where: { organizationId: orgId, documentType, documentId },
  })
  if (lots.length === 0) return 0
  const method = await getOrgCostingMethod(tx, orgId)
  for (const lot of lots) {
    if (method === 'WEIGHTED_AVERAGE') await assertNoLaterStockIssue(tx, orgId, lot)
    if (Math.abs(toNumber(lot.qtyBalance) - toNumber(lot.qtyIn)) > QTY_EPSILON) {
      throw new ApiError(
        'Cannot reverse: inventory added by this document has already been consumed or sold. Reverse the dependent transactions first.',
        422,
      )
    }
    const originalValue = lot.initialValue != null ? toNumber(lot.initialValue) : asMoney(toNumber(lot.qtyIn) * toNumber(lot.unitCost))
    if (method === 'FIFO' && lot.carryingValue != null && Math.abs(toNumber(lot.carryingValue) - originalValue) > 0.001) {
      throw new ApiError('Cannot reverse: this receipt has a different carrying value after valuation changes. Reverse the dependent transactions first.', 422)
    }
  }

  let valueRemoved = 0
  for (const lot of lots) {
    const qty = toNumber(lot.qtyIn)
    const unitCost = toNumber(lot.unitCost)
    const value = lot.initialValue != null ? toNumber(lot.initialValue) : asMoney(qty * unitCost)
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
    if (await getOrgCostingMethod(tx, orgId) === 'WEIGHTED_AVERAGE') {
      await refreshWarehouseCarryingValues(tx, orgId, lot.itemId, lot.warehouseId)
    }
  }
  return asMoney(valueRemoved)
}

/**
 * Back-compat wrapper: reverse the PURCHASE cost layers a bill / goods receipt
 * booked. Delegates to {@link reverseAddedLayers} with documentType PURCHASE.
 */
export async function reversePurchaseLayers(
  tx: Prisma.TransactionClient,
  orgId: string,
  documentId: string,
  date: Date,
  additionalItemIds: readonly string[] = [],
): Promise<number> {
  // Read identities only before waiting; reverseAddedLayers re-reads balances
  // under these locks. Corrections include replacement items up front so no new
  // item lock is acquired after journal numbering or out of sorted order.
  const sourceLots = await tx.inventoryLot.findMany({
    where: { organizationId: orgId, documentType: InventoryDocumentType.PURCHASE, documentId },
    select: { itemId: true },
  })
  await lockInventoryItems(tx, orgId, [...sourceLots.map(lot => lot.itemId), ...additionalItemIds])
  return reverseAddedLayers(tx, orgId, InventoryDocumentType.PURCHASE, documentId, date)
}

/**
 * Un-consume: tracked sales restore their original lot quantities and mark the
 * outbound movement reversed. requireExact rejects incomplete/legacy tracking.
 * Other movements and legacy sales use replacement lots at recorded value.
 * Restore the stock a document drew down (e.g. when voiding an
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
  opts: { requireExact?: boolean } = {},
): Promise<number> {
  const where = { organizationId: orgId, documentType, documentId, qtyOut: { gt: 0 }, ...(documentType === 'SALES' ? { reversedAt: null } : {}) }
  const identities = await tx.inventoryLedgerEntry.findMany({ where, select: { itemId: true } })
  // Applies to supplier-return restoration too. Re-read tracked lot details
  // and movements only after waiting for every affected item in sorted order.
  await lockInventoryItems(tx, orgId, identities.map(entry => entry.itemId))
  const outbound = await tx.inventoryLedgerEntry.findMany({
    where,
    include: { lotDraws: { include: { lot: true } } },
  })
  if (outbound.length === 0) return 0

  if (documentType === 'SALES') {
    if (opts.requireExact && outbound.some(entry => !entry.drawsTracked ||
      entry.lotDraws.some(draw => !draw.lot) ||
      Math.abs(entry.lotDraws.reduce((sum, draw) => sum + toNumber(draw.quantity), 0) - toNumber(entry.qtyOut)) > QTY_EPSILON)) {
      throw new ApiError('This invoice has no complete original stock-lot tracking — void it to change.', 422)
    }
  }

  let valueRestored = 0
  for (const entry of outbound) {
    const qty = toNumber(entry.qtyOut)
    const value = asMoney(-toNumber(entry.valueChange)) // exact total removed
    const unitCost = qty > 0 ? value / qty : 0
    valueRestored += value

    // New sales restore the exact source lots. Negative-stock shortfalls and
    // historical movements keep the old value-neutral replacement-lot path.
    const exact = canRestoreExactSalesValue(entry, orgId)
    if (exact) {
      for (const draw of entry.lotDraws) {
        const restored = await tx.inventoryLot.updateMany({
          where: { id: draw.lotId!, organizationId: orgId, itemId: entry.itemId, qtyOut: { gte: draw.quantity } },
          data: { qtyOut: { decrement: draw.quantity }, qtyBalance: { increment: draw.quantity },
            ...(draw.lot?.carryingValue != null ? { carryingValue: { increment: draw.costValue != null ? draw.costValue : asMoney(toNumber(draw.quantity) * toNumber(draw.lot.unitCost)) } } : {}) },
        })
        if (restored.count !== 1) throw new ApiError('Original stock lot is no longer available for exact restoration.', 422)
      }
    } else {
      if (opts.requireExact) throw new ApiError('Original stock lots cannot be restored exactly — void this invoice to change.', 422)

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
          initialValue: value,
          carryingValue: value,
        },
      })
    }
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
    if (documentType === 'SALES') await tx.inventoryLedgerEntry.update({ where: { id: entry.id }, data: { reversedAt: date } })
    if (await getOrgCostingMethod(tx, orgId) === 'WEIGHTED_AVERAGE') {
      await refreshWarehouseCarryingValues(tx, orgId, entry.itemId, entry.warehouseId)
    }
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
  // Discover item identities first, then re-read quantities under the shared
  // item locks. A sale/return must not consume an increase while it is removed.
  const movements = await tx.inventoryLedgerEntry.findMany({
    where: { organizationId: orgId, documentType: InventoryDocumentType.ADJUSTMENT, documentId },
    select: { itemId: true },
  })
  const sourceLots = await tx.inventoryLot.findMany({
    where: { organizationId: orgId, documentType: InventoryDocumentType.ADJUSTMENT, documentId },
    select: { itemId: true },
  })
  await lockInventoryItems(tx, orgId, [...movements, ...sourceLots].map(row => row.itemId))
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
  const method = await getOrgCostingMethod(tx, orgId)
  for (const lot of addedLots) {
    if (method === 'WEIGHTED_AVERAGE') await assertNoLaterStockIssue(tx, orgId, lot)
    if (Math.abs(toNumber(lot.qtyBalance) - toNumber(lot.qtyIn)) > QTY_EPSILON) {
      throw new ApiError(
        'Cannot void: stock added by this adjustment has already been consumed or sold. Reverse the dependent transactions first.',
        422,
      )
    }
    const originalValue = lot.initialValue != null ? toNumber(lot.initialValue) : asMoney(toNumber(lot.qtyIn) * toNumber(lot.unitCost))
    if (method === 'FIFO' && lot.carryingValue != null && Math.abs(toNumber(lot.carryingValue) - originalValue) > 0.001) {
      throw new ApiError('Cannot void: stock carrying value differs from its original posted value. Reverse the dependent transactions first.', 422)
    }
  }

  let netReversed = 0

  // Remove the increases (delete the layer, append a contra ledger row).
  for (const lot of addedLots) {
    const qty = toNumber(lot.qtyIn)
    const unitCost = toNumber(lot.unitCost)
    const value = lot.initialValue != null ? toNumber(lot.initialValue) : asMoney(qty * unitCost)
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
        initialValue: value,
        carryingValue: value,
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

  if (await getOrgCostingMethod(tx, orgId) === 'WEIGHTED_AVERAGE') {
    const scopes = new Map<string, { itemId: string; warehouseId: string | null }>()
    for (const row of [...addedLots, ...outbound]) scopes.set(`${row.itemId}:${row.warehouseId ?? ''}`, { itemId: row.itemId, warehouseId: row.warehouseId })
    for (const scope of scopes.values()) await refreshWarehouseCarryingValues(tx, orgId, scope.itemId, scope.warehouseId)
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
): Promise<{ totalCost: number; cogsPerUnit: number; draws: Array<{ lotId: string | null; quantity: number; costValue: number }> }> {
  // Fetch open lots ordered oldest-first (FIFO)
  const lots = await tx.inventoryLot.findMany({
    where: {
      organizationId: orgId,
      itemId,
      warehouseId,
      qtyBalance: { gt: 0 },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  let remaining = qty
  let totalCost = 0
  const draws: Array<{ lotId: string | null; quantity: number; costValue: number }> = []

  for (const lot of lots) {
    if (remaining <= 0) break
    const lotBalance = toNumber(lot.qtyBalance)
    const consume = Math.min(lotBalance, remaining)
    const lotCost = toNumber(lot.unitCost)

    const costValue = lot.carryingValue != null ? asMoney(toNumber(lot.carryingValue) * consume / lotBalance) : asMoney(consume * lotCost)
    totalCost += costValue
    remaining -= consume
    draws.push({ lotId: lot.id, quantity: consume, costValue })

    await tx.inventoryLot.update({
      where: { id: lot.id },
      data: {
        qtyOut: { increment: consume },
        qtyBalance: { decrement: consume },
        ...(lot.carryingValue != null ? { carryingValue: { decrement: costValue } } : {}),
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
    draws.push({ lotId: null, quantity: remaining, costValue: asMoney(remaining * fallbackCost) })
  }

  const cogsPerUnit = qty > 0 ? totalCost / qty : 0

  return {
    totalCost: asMoney(totalCost),
    cogsPerUnit: asMoney(cogsPerUnit),
    draws,
  }
}

/**
 * Moving average follows booked movement value, not original receipt prices.
 * Receipt prices remain on lots for traceability; oldest-first quantity draws
 * must not change the average of the remaining book-value pool.
 */
export async function getWeightedAverageCost(
  tx: Prisma.TransactionClient,
  orgId: string,
  itemId: string,
  warehouseId: string | null
): Promise<number> {
  const pool = await tx.inventoryLedgerEntry.aggregate({
    where: {
      organizationId: orgId,
      itemId,
      warehouseId,
    },
    _sum: { qtyIn: true, qtyOut: true, valueChange: true },
  })
  const quantity = toNumber(pool._sum.qtyIn) - toNumber(pool._sum.qtyOut)
  const value = toNumber(pool._sum.valueChange)
  const physical = await tx.inventoryLot.aggregate({
    where: { organizationId: orgId, itemId, warehouseId, qtyBalance: { gt: 0 } },
    _sum: { qtyBalance: true },
  })
  const physicalQuantity = toNumber(physical._sum.qtyBalance)
  if (Math.abs(quantity) <= QTY_EPSILON && Math.abs(value) > 0.001) {
    throw new ApiError('Inventory has value but no quantity. Reconcile the recorded inventory movements before posting.', 422)
  }
  if (quantity >= -QTY_EPSILON && Math.abs(physicalQuantity - quantity) > QTY_EPSILON) {
    throw new ApiError('Inventory quantity or value does not reconcile in this costing scope. Reconcile the recorded movements before posting.', 422)
  }
  if (quantity <= QTY_EPSILON) {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { costPrice: true },
    })
    return toNumber(item?.costPrice)
  }

  if (value < 0) {
    throw new ApiError('Inventory quantity or value does not reconcile in this costing scope. Reconcile the recorded movements before posting.', 422)
  }
  return value / quantity
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
  await lockInventoryItems(tx, orgId, [itemId])
  const method = await getOrgCostingMethod(tx, orgId)
  const lots = await tx.inventoryLot.findMany({ where: { organizationId: orgId, itemId,
    ...(docType === 'SALES' && !warehouseId ? {} : { warehouseId }), qtyBalance: { gt: 0 } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })
  // Sales without an explicit warehouse choose physical lots oldest-first.
  // Other documents' null warehouse identifies only the unassigned stock pool.
  // Cost and movement identity belong to each actual warehouse.
  const groups = new Map<string | null, { quantity: number; draws: Array<{ lotId: string | null; quantity: number }> }>()
  let remaining = qty
  for (const lot of lots) {
    if (remaining <= QTY_EPSILON) break
    const quantity = Math.min(toNumber(lot.qtyBalance), remaining)
    remaining -= quantity
    const sourceWarehouse = lot.warehouseId ?? null
    const group = groups.get(sourceWarehouse) ?? { quantity: 0, draws: [] }
    group.quantity += quantity
    group.draws.push({ lotId: lot.id, quantity })
    groups.set(sourceWarehouse, group)
  }
  if (remaining > QTY_EPSILON) {
    const key = warehouseId ?? null
    const group = groups.get(key) ?? { quantity: 0, draws: [] }
    group.quantity += remaining
    group.draws.push({ lotId: null, quantity: remaining })
    groups.set(key, group)
  }
  let totalCost = 0
  for (const [sourceWarehouse, group] of groups) {
    let cost: number, unitCost: number
    let draws: Array<{ lotId: string | null; quantity: number; costValue: number }>
    if (method === 'FIFO') {
      const result = await consumeFIFO(tx, orgId, itemId, sourceWarehouse, group.quantity, docType, docId, date)
      cost = result.totalCost; unitCost = result.cogsPerUnit; draws = result.draws
    } else {
      unitCost = await getWeightedAverageCost(tx, orgId, itemId, sourceWarehouse)
      cost = asMoney(group.quantity * unitCost)
      const allocation = allocateInventoryCarryingValue(group.draws.map((draw, index) => ({ id: String(index), quantity: draw.quantity.toFixed(4) })), cost.toFixed(2))
      const amounts = new Map(allocation.map(row => [row.id, Number(row.carryingValue)]))
      draws = group.draws.map((draw, index) => ({ ...draw, costValue: amounts.get(String(index))! }))
      for (const draw of draws) {
        if (draw.lotId) await tx.inventoryLot.update({ where: { id: draw.lotId }, data: {
          qtyOut: { increment: draw.quantity }, qtyBalance: { decrement: draw.quantity },
        } })
      }
    }
    totalCost += cost
    await tx.inventoryLedgerEntry.create({ data: {
      organizationId: orgId, itemId, warehouseId: sourceWarehouse, date,
      documentType: docType, documentId: docId, qtyIn: 0, qtyOut: group.quantity,
      unitCost, valueChange: -cost,
      ...(docType === 'SALES' ? { drawsTracked: true, lotDraws: { create: draws } } : {}),
    } })
    if (method === 'WEIGHTED_AVERAGE') await refreshWarehouseCarryingValues(tx, orgId, itemId, sourceWarehouse)
  }
  return asMoney(totalCost)
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
  date: Date,
  opts: { allowNegativeStock?: boolean } = {},
): Promise<number> {
  // Serialize outbound consumption per item BEFORE the sufficiency check. Two
  // concurrent sales of the same item each read on-hand with a plain findMany
  // then decrement relatively (qtyBalance:{decrement}); under READ COMMITTED
  // both pass assertSufficientStock against the same balance and drive stock
  // negative. This transaction-scoped advisory lock makes the loser block here
  // and re-read the winner's committed balance, so its sufficiency check
  // correctly fails. (The lock is txn-scoped — released at commit/rollback.)
  await lockInventoryItems(tx, orgId, [itemId])
  await assertSufficientStock(tx, orgId, itemId, warehouseId, qty, opts.allowNegativeStock ?? false, docType === 'SALES')
  return relieveCostLayers(tx, orgId, itemId, warehouseId, qty, docType, docId, date)
}
