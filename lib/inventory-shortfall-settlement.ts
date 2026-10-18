import { Prisma, InventoryDocumentType } from '@prisma/client'
import { ApiError } from './errors'
import { allocateShortfallReceipt, type EstimatedShortfall } from './inventory-shortfall-allocation'
import { assertPeriodOpen } from './period-guard'
import { postJournalEntry } from './journal-posting'
import { loadOrgAccountDefaults, resolveAccountDefaultId } from './account-defaults'

/**
 * Finance-approved Weighted Average negative stock (2026-10-15). A sale beyond
 * physical stock keeps its estimated cost on an explicit shortfall draw. A later
 * receipt into the same item/warehouse pool covers the oldest outstanding
 * estimates: covered quantity is consumed from the receipt lot (only excess stays
 * on hand) and the actual-minus-estimate difference is posted on the receipt
 * date as one value-only stock movement per covered draw plus one COGS journal.
 *
 * Every function here expects the caller to hold lockInventoryItems for the
 * item, taken before journal numbering. Pool consistency is enforced afterwards
 * by refreshWarehouseCarryingValues.
 */

type Tx = Prisma.TransactionClient
const ZERO = new Prisma.Decimal(0)

/**
 * Settlement and reversal journals share the date of the receipt or void that
 * triggers them, and that posting path has already applied the user's
 * transaction-date window to it. Re-check only that the period is open here;
 * re-applying the window would refuse a back-dated receipt the user may post.
 */
const assertSettlementPeriodOpen = (tx: Tx, orgId: string, date: Date) =>
  assertPeriodOpen(tx, orgId, date, { overrideDateRestriction: true })

export type ShortfallEstimate = EstimatedShortfall & { ledgerEntryId: string }
type Settlement = Prisma.InventoryShortfallSettlementGetPayload<object>

/** Shortfall draws of active (unreversed) sales in one pool, oldest posting first. */
export async function loadShortfallEstimates(
  tx: Tx, orgId: string, itemId: string, warehouseId: string | null,
): Promise<ShortfallEstimate[]> {
  const draws = await tx.inventoryLotDraw.findMany({
    where: { shortfall: true, ledgerEntry: { organizationId: orgId, itemId, warehouseId, documentType: 'SALES', reversedAt: null } },
    include: { ledgerEntry: { select: { postingSequence: true } }, settlements: { where: { reversedAt: null } } },
  })
  draws.sort((a, b) => (a.ledgerEntry.postingSequence ?? Infinity) - (b.ledgerEntry.postingSequence ?? Infinity) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return draws.map(draw => {
    if (draw.costValue == null || draw.lotId != null) {
      throw new ApiError('Estimated shortage tracking is incomplete for this item and warehouse. Review its negative stock before posting.', 422)
    }
    return {
      id: draw.id, ledgerEntryId: draw.ledgerEntryId,
      quantity: draw.quantity.toFixed(4), estimatedValue: draw.costValue.toFixed(2),
      settledQuantity: draw.settlements.reduce((sum, row) => sum.plus(row.quantity), ZERO).toFixed(4),
      settledEstimatedValue: draw.settlements.reduce((sum, row) => sum.plus(row.estimatedValue), ZERO).toFixed(2),
    }
  })
}

export function outstanding(estimate: EstimatedShortfall) {
  return {
    quantity: new Prisma.Decimal(estimate.quantity).minus(estimate.settledQuantity),
    value: new Prisma.Decimal(estimate.estimatedValue).minus(estimate.settledEstimatedValue),
  }
}

/** Uncovered shortage of a pool; a tracked negative pool equals minus these totals. */
export async function outstandingShortfallTotals(tx: Tx, orgId: string, itemId: string, warehouseId: string | null) {
  const rows = (await loadShortfallEstimates(tx, orgId, itemId, warehouseId)).map(outstanding)
  return {
    quantity: rows.reduce((sum, row) => sum.plus(row.quantity), ZERO),
    value: rows.reduce((sum, row) => sum.plus(row.value), ZERO),
  }
}

/**
 * Stock restored by a reversal (not a receipt) would sit beside an uncovered
 * estimate and break the pool. Refuse: the estimates depend on that history.
 */
export async function assertNoOutstandingShortfall(
  tx: Tx, orgId: string, itemId: string, warehouseId: string | null, excludeLedgerEntryIds: readonly string[] = [],
) {
  const pending = (await loadShortfallEstimates(tx, orgId, itemId, warehouseId))
    .filter(row => !excludeLedgerEntryIds.includes(row.ledgerEntryId) && outstanding(row).quantity.gt(0))
  if (pending.length) {
    throw new ApiError('Cannot restore stock: a sale in this warehouse still has an estimated shortage that depends on it. Void that sale or receive stock first.', 422)
  }
}

async function cogsAccounts(tx: Tx, orgId: string) {
  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  })
  const settings = await loadOrgAccountDefaults(tx, orgId)
  const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset')
  const cogsAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense')
  if (!inventoryAccountId || !cogsAccountId) {
    throw new ApiError('Cannot settle an estimated stock shortage: configure the Inventory Asset and COGS accounts in Settings first.', 422)
  }
  return { inventoryAccountId, cogsAccountId }
}

/** Positive amount: Dr COGS / Cr Inventory. Negative: the reverse. */
function cogsLines(accounts: { inventoryAccountId: string; cogsAccountId: string }, amount: Prisma.Decimal, label: string) {
  const value = amount.abs().toNumber()
  const cogs = { accountId: accounts.cogsAccountId, description: `COGS ${label}`, debit: amount.gt(0) ? value : 0, credit: amount.gt(0) ? 0 : value }
  const inventory = { accountId: accounts.inventoryAccountId, description: `Inventory ${label}`, debit: amount.gt(0) ? 0 : value, credit: amount.gt(0) ? value : 0 }
  return [cogs, inventory]
}

export type ShortfallReceipt = {
  lotId: string
  inboundLedgerEntryId: string
  itemId: string
  warehouseId: string | null
  quantity: Prisma.Decimal
  value: Prisma.Decimal
  documentType: InventoryDocumentType
  documentId: string
  date: Date
}

/**
 * Settle outstanding estimates from a receipt just added to the pool. Returns
 * the COGS adjustment posted (0 when nothing was outstanding).
 */
export async function settleShortfallsFromReceipt(tx: Tx, orgId: string, receipt: ShortfallReceipt): Promise<number> {
  const estimates = (await loadShortfallEstimates(tx, orgId, receipt.itemId, receipt.warehouseId))
    .filter(row => outstanding(row).quantity.gt(0))
  if (!estimates.length || !receipt.quantity.gt(0)) return 0
  // The difference is recognized on the receipt date, so that date's period must be open.
  await assertSettlementPeriodOpen(tx, orgId, receipt.date)
  let proposal: ReturnType<typeof allocateShortfallReceipt>
  try {
    proposal = allocateShortfallReceipt(receipt.quantity.toFixed(4), receipt.value.toFixed(2), estimates)
  } catch {
    throw new ApiError('Estimated shortage settlement for this item and warehouse requires review before receiving stock.', 422)
  }
  const accounts = await cogsAccounts(tx, orgId)
  const covered = new Prisma.Decimal(proposal.coveredQuantity)
  const consumed = await tx.inventoryLot.updateMany({
    where: { id: receipt.lotId, organizationId: orgId, qtyBalance: { gte: covered } },
    data: { qtyOut: { increment: covered }, qtyBalance: { decrement: covered } },
  })
  if (consumed.count !== 1) throw new ApiError('Received stock lot changed while settling an estimated shortage. Retry the receipt.', 409)

  const movements = new Map<string, string | null>()
  for (const row of proposal.allocations) {
    const adjustment = new Prisma.Decimal(row.cogsAdjustment)
    movements.set(row.shortfallId, adjustment.isZero() ? null : (await tx.inventoryLedgerEntry.create({ data: {
      organizationId: orgId, itemId: receipt.itemId, warehouseId: receipt.warehouseId, date: receipt.date,
      documentType: InventoryDocumentType.SHORTFALL_SETTLEMENT, documentId: receipt.documentId,
      qtyIn: 0, qtyOut: 0, unitCost: 0, valueChange: adjustment.negated(),
    }, select: { id: true } })).id)
  }
  const net = new Prisma.Decimal(proposal.cogsAdjustment)
  const journal = net.isZero() ? null : await postJournalEntry(tx, {
    organizationId: orgId, date: receipt.date,
    memo: `Stock shortage cost settlement: ${receipt.documentType} ${receipt.documentId}`,
    lines: cogsLines(accounts, net, 'shortage settlement'),
  })
  const ledgerEntries = new Map(estimates.map(row => [row.id, row.ledgerEntryId]))
  for (const row of proposal.allocations) {
    await tx.inventoryShortfallSettlement.create({ data: {
      organizationId: orgId, itemId: receipt.itemId, warehouseId: receipt.warehouseId,
      saleDrawId: row.shortfallId, saleLedgerEntryId: ledgerEntries.get(row.shortfallId)!,
      receiptLedgerEntryId: receipt.inboundLedgerEntryId, receiptLotId: receipt.lotId,
      adjustmentLedgerEntryId: movements.get(row.shortfallId) ?? null, journalEntryId: journal?.id ?? null,
      date: receipt.date, quantity: row.quantity, estimatedValue: row.estimatedValue,
      actualValue: row.actualValue, cogsAdjustment: row.cogsAdjustment,
    } })
  }
  return net.toNumber()
}

/**
 * Undo settlements: the covered receipt quantity becomes available again and
 * the posted difference is reversed on the reversal date. All or nothing; a
 * concurrent unwind of the same row fails the transaction.
 */
async function unwindSettlements(
  tx: Tx, orgId: string, rows: readonly Settlement[], reversal: { documentId: string; date: Date; memo: string },
): Promise<number> {
  if (!rows.length) return 0
  await assertSettlementPeriodOpen(tx, orgId, reversal.date)
  const accounts = await cogsAccounts(tx, orgId)
  const movements = new Map<string, string | null>()
  for (const row of rows) {
    const released = row.receiptLotId ? await tx.inventoryLot.updateMany({
      where: { id: row.receiptLotId, organizationId: orgId, qtyOut: { gte: row.quantity } },
      data: { qtyOut: { decrement: row.quantity }, qtyBalance: { increment: row.quantity } },
    }) : { count: 0 }
    if (released.count !== 1) {
      throw new ApiError('The receipt that settled this estimated shortage is no longer available. Review the stock history before reversing.', 422)
    }
    movements.set(row.id, row.cogsAdjustment.isZero() ? null : (await tx.inventoryLedgerEntry.create({ data: {
      organizationId: orgId, itemId: row.itemId, warehouseId: row.warehouseId, date: reversal.date,
      documentType: InventoryDocumentType.SHORTFALL_SETTLEMENT, documentId: reversal.documentId,
      qtyIn: 0, qtyOut: 0, unitCost: 0, valueChange: row.cogsAdjustment,
    }, select: { id: true } })).id)
  }
  const net = rows.reduce((sum, row) => sum.plus(row.cogsAdjustment), ZERO)
  const journal = net.isZero() ? null : await postJournalEntry(tx, {
    organizationId: orgId, date: reversal.date, memo: reversal.memo, source: 'REVERSAL',
    lines: cogsLines(accounts, net.negated(), 'shortage settlement reversal'),
  })
  for (const row of rows) {
    const marked = await tx.inventoryShortfallSettlement.updateMany({
      where: { id: row.id, organizationId: orgId, reversedAt: null },
      data: { reversedAt: reversal.date, reversalLedgerEntryId: movements.get(row.id) ?? null, reversalJournalEntryId: journal?.id ?? null },
    })
    if (marked.count !== 1) throw new ApiError('This estimated shortage settlement was already reversed.', 409)
  }
  return net.toNumber()
}

/**
 * Receipt void: unwind the settlements the document's lots made so each lot is
 * whole again. A later receipt that settled the remainder of the same sale draw
 * relies on this one's cumulative rounding, so it must be reversed first.
 */
export async function unwindReceiptSettlements(
  tx: Tx, orgId: string, lotIds: readonly string[], reversal: { documentId: string; date: Date },
): Promise<number> {
  if (!lotIds.length) return 0
  const rows = await tx.inventoryShortfallSettlement.findMany({
    where: { organizationId: orgId, receiptLotId: { in: [...lotIds] }, reversedAt: null }, orderBy: { settlementSequence: 'asc' },
  })
  if (!rows.length) return 0
  const later = await tx.inventoryShortfallSettlement.findFirst({ where: {
    organizationId: orgId, reversedAt: null, saleDrawId: { in: rows.map(row => row.saleDrawId) },
    settlementSequence: { gt: rows[0].settlementSequence },
    OR: [{ receiptLotId: null }, { receiptLotId: { notIn: [...lotIds] } }],
  }, select: { id: true } })
  if (later) {
    throw new ApiError('Cannot reverse: a later receipt settled the rest of the same estimated stock shortage. Reverse that receipt first.', 422)
  }
  return unwindSettlements(tx, orgId, rows, { ...reversal, memo: `Void stock shortage settlement: receipt ${reversal.documentId}` })
}

/** Sale void: unwind every settlement of the sale's shortfall draws. */
export async function unwindSaleSettlements(
  tx: Tx, orgId: string, drawIds: readonly string[], reversal: { documentId: string; date: Date },
): Promise<number> {
  if (!drawIds.length) return 0
  const rows = await tx.inventoryShortfallSettlement.findMany({
    where: { organizationId: orgId, saleDrawId: { in: [...drawIds] }, reversedAt: null }, orderBy: { settlementSequence: 'asc' },
  })
  return unwindSettlements(tx, orgId, rows, { ...reversal, memo: `Void stock shortage settlement: sale ${reversal.documentId}` })
}

/** Released receipt quantity a sale void will put back on hand. */
export async function settledShortfallQuantity(tx: Tx, orgId: string, drawIds: readonly string[]) {
  if (!drawIds.length) return ZERO
  const rows = await tx.inventoryShortfallSettlement.findMany({
    where: { organizationId: orgId, saleDrawId: { in: [...drawIds] }, reversedAt: null }, select: { quantity: true },
  })
  return rows.reduce((sum, row) => sum.plus(row.quantity), ZERO)
}
