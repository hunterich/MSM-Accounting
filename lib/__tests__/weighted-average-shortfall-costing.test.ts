/**
 * Weighted Average negative-stock posting paths in inventory-costing: the sale
 * keeps its estimate on an explicit shortfall draw, receipts hand the new lot to
 * settlement, and voids unwind settlements before stock is put back. Settlement
 * and pool refresh are mocked here; their own tests cover them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryDocumentType, Prisma } from '@prisma/client'

vi.mock('../inventory-carrying-values', () => ({ refreshWarehouseCarryingValues: vi.fn(async () => undefined) }))
vi.mock('../inventory-inbound-reversal', () => ({ assertNoLaterStockIssue: vi.fn(async () => undefined) }))
vi.mock('../inventory-shortfall-settlement', () => ({
  settleShortfallsFromReceipt: vi.fn(async () => 0),
  unwindReceiptSettlements: vi.fn(async () => 0),
  unwindSaleSettlements: vi.fn(async () => 0),
  settledShortfallQuantity: vi.fn(async () => new Prisma.Decimal(0)),
  assertNoOutstandingShortfall: vi.fn(async () => undefined),
}))

import { addCostLayer, relieveCostLayers, restoreConsumedLayers, reverseAddedLayers } from '../inventory-costing'
import * as settlement from '../inventory-shortfall-settlement'
import { refreshWarehouseCarryingValues } from '../inventory-carrying-values'

type AnyFn = ReturnType<typeof vi.fn>
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value)
// Mock whose recorded call arguments can be inspected.
const returns = (value: unknown) => vi.fn(async (..._args: any[]) => value)
const DATE = new Date('2026-09-10')

function saleTx(opts: { lots: Array<{ id: string; qtyBalance: number }>; pool: { qtyIn: number; qtyOut: number; value: number }; costPrice?: number }) {
  return {
    $executeRaw: vi.fn(async () => 0),
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE', allowNegativeStock: true })) },
    item: { findUnique: vi.fn(async () => ({ costPrice: opts.costPrice ?? 0, sku: 'SKU', name: 'Item' })) },
    inventoryLot: {
      findMany: vi.fn(async () => opts.lots.map(lot => ({ ...lot, warehouseId: null, date: DATE }))),
      aggregate: vi.fn(async () => ({ _sum: { qtyBalance: opts.lots.reduce((sum, lot) => sum + lot.qtyBalance, 0) } })),
      update: vi.fn(async () => ({})),
    },
    inventoryLedgerEntry: {
      aggregate: vi.fn(async () => ({ _sum: { qtyIn: opts.pool.qtyIn, qtyOut: opts.pool.qtyOut, valueChange: opts.pool.value } })),
      create: vi.fn(async () => ({})),
    },
  }
}
const ledgerData = (tx: { inventoryLedgerEntry: { create: AnyFn } }) => tx.inventoryLedgerEntry.create.mock.calls[0][0].data

beforeEach(() => vi.clearAllMocks())

describe('Weighted Average sale beyond stock on hand', () => {
  it('records the approved 700 estimate: drained lot at exact book value, shortfall at the remainder', async () => {
    const tx = saleTx({ lots: [{ id: 'lot-a', qtyBalance: 5 }], pool: { qtyIn: 5, qtyOut: 0, value: 500 }, costPrice: 999 })
    expect(await relieveCostLayers(tx as never, 'org', 'item', null, 7, InventoryDocumentType.SALES, 'inv', DATE)).toBe(700)
    expect(ledgerData(tx)).toMatchObject({ qtyOut: 7, valueChange: -700, drawsTracked: true, lotDraws: { create: [
      { lotId: 'lot-a', quantity: 5, costValue: 500 },
      { lotId: null, quantity: 2, costValue: 200, shortfall: true },
    ] } })
    expect(tx.inventoryLot.update).toHaveBeenCalledTimes(1)
  })

  it('keeps the pool exact when the average does not divide evenly', async () => {
    const tx = saleTx({ lots: [{ id: 'lot-a', qtyBalance: 3 }], pool: { qtyIn: 3, qtyOut: 0, value: 100.01 } })
    expect(await relieveCostLayers(tx as never, 'org', 'item', null, 5, InventoryDocumentType.SALES, 'inv', DATE)).toBe(166.68)
    // The lot draw removes exactly 100.01, so the pool ends at minus the 66.67 estimate.
    expect(ledgerData(tx).lotDraws.create).toEqual([
      { lotId: 'lot-a', quantity: 3, costValue: 100.01 },
      { lotId: null, quantity: 2, costValue: 66.67, shortfall: true },
    ])
  })

  it('estimates a sale from an already-short pool at the item cost price', async () => {
    const tx = saleTx({ lots: [], pool: { qtyIn: 5, qtyOut: 7, value: -200 }, costPrice: 90 })
    expect(await relieveCostLayers(tx as never, 'org', 'item', null, 1, InventoryDocumentType.SALES, 'inv', DATE)).toBe(90)
    expect(ledgerData(tx).lotDraws.create).toEqual([{ lotId: null, quantity: 1, costValue: 90, shortfall: true }])
  })

  it.each([InventoryDocumentType.ADJUSTMENT, InventoryDocumentType.PURCHASE_RETURN])('refuses a %s beyond stock on hand', async docType => {
    const tx = saleTx({ lots: [{ id: 'lot-a', qtyBalance: 1 }], pool: { qtyIn: 1, qtyOut: 0, value: 100 } })
    await expect(relieveCostLayers(tx as never, 'org', 'item', null, 2, docType, 'doc', DATE)).rejects.toThrow('Receive the stock first')
    expect(tx.inventoryLot.update).not.toHaveBeenCalled()
    expect(tx.inventoryLedgerEntry.create).not.toHaveBeenCalled()
  })
})

describe('Weighted Average receipt into a short pool', () => {
  function receiptTx(costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE') {
    return {
      $executeRaw: vi.fn(async () => 0),
      organization: { findUnique: vi.fn(async () => ({ costingMethod })) },
      inventoryLedgerEntry: { create: vi.fn(async () => ({ id: 'inbound-1' })) },
      inventoryLot: { create: vi.fn(async () => ({ id: 'lot-r', qtyIn: D(2), initialValue: D(240) })) },
    }
  }

  it('hands the stored lot quantity and exact value to settlement before refreshing the pool', async () => {
    const tx = receiptTx('WEIGHTED_AVERAGE')
    await addCostLayer(tx as never, 'org', 'item', 'wh-1', 2, 120, InventoryDocumentType.PURCHASE, 'bill-1', DATE, 240)
    expect(settlement.settleShortfallsFromReceipt).toHaveBeenCalledWith(tx, 'org', { lotId: 'lot-r', inboundLedgerEntryId: 'inbound-1',
      itemId: 'item', warehouseId: 'wh-1', quantity: D(2), value: D(240), documentType: 'PURCHASE', documentId: 'bill-1', date: DATE })
    const settled = (settlement.settleShortfallsFromReceipt as AnyFn).mock.invocationCallOrder[0]
    expect(settled).toBeLessThan((refreshWarehouseCarryingValues as AnyFn).mock.invocationCallOrder[0])
  })

  it('leaves FIFO receipts alone', async () => {
    await addCostLayer(receiptTx('FIFO') as never, 'org', 'item', null, 2, 120, InventoryDocumentType.PURCHASE, 'bill-1', DATE, 240)
    expect(settlement.settleShortfallsFromReceipt).not.toHaveBeenCalled()
  })
})

describe('Weighted Average voids with estimated shortages', () => {
  const lotA = { id: 'lot-a', organizationId: 'org', itemId: 'item', unitCost: D(100), carryingValue: D(0) }
  const shortSale = {
    id: 'sale-entry', itemId: 'item', warehouseId: null, documentType: 'SALES', drawsTracked: true, postingSequence: 7,
    qtyOut: D(7), valueChange: D(-700),
    lotDraws: [
      { id: 'draw-lot', lotId: 'lot-a', lot: lotA, quantity: D(5), costValue: D(500), shortfall: false },
      { id: 'draw-short', lotId: null, lot: null, quantity: D(2), costValue: D(200), shortfall: true },
    ],
  }
  function voidTx(entries: unknown[]) {
    return {
      $executeRaw: vi.fn(async () => 0),
      organization: { findUnique: vi.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
      inventoryLedgerEntry: { findMany: returns(entries), create: returns({}), update: returns({}) },
      inventoryLot: { updateMany: returns({ count: 1 }), create: returns({}) },
    }
  }

  it('sale void unwinds settlements, restores only physical lots and reverses the full estimate in the ledger', async () => {
    vi.mocked(settlement.settledShortfallQuantity).mockResolvedValueOnce(D(2))
    const tx = voidTx([shortSale])
    expect(await restoreConsumedLayers(tx as never, 'org', InventoryDocumentType.SALES, 'inv', DATE)).toBe(700)
    expect(settlement.assertNoOutstandingShortfall).toHaveBeenCalledWith(tx, 'org', 'item', null, ['sale-entry'])
    expect(settlement.unwindSaleSettlements).toHaveBeenCalledWith(tx, 'org', ['draw-short'], { documentId: 'inv', date: DATE })
    expect(tx.inventoryLot.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.inventoryLot.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'lot-a' }, data: { qtyBalance: { increment: D(5) } } })
    expect(tx.inventoryLot.create).not.toHaveBeenCalled()
    expect(tx.inventoryLedgerEntry.create.mock.calls[0][0].data).toMatchObject({ qtyIn: 7, valueChange: 700, reversesLedgerEntryId: 'sale-entry' })
  })

  it('voids a later shortage line before an earlier stocked line of the same invoice', async () => {
    const stocked = { ...shortSale, id: 'line-1', postingSequence: 3, qtyOut: D(5), valueChange: D(-500), lotDraws: [shortSale.lotDraws[0]] }
    const short = { ...shortSale, id: 'line-2', postingSequence: 4, qtyOut: D(2), valueChange: D(-200), lotDraws: [shortSale.lotDraws[1]] }
    const tx = voidTx([stocked, short])
    await restoreConsumedLayers(tx as never, 'org', InventoryDocumentType.SALES, 'inv', DATE)
    expect(tx.inventoryLedgerEntry.update.mock.calls.map(call => call[0].where.id)).toEqual(['line-2', 'line-1'])
    // Only the stocked line puts units back on hand.
    expect(vi.mocked(settlement.assertNoOutstandingShortfall).mock.calls.map(call => call[4])).toEqual([['line-1']])
  })

  it('editing an invoice with an estimated shortage requires void and replace', async () => {
    const tx = voidTx([shortSale])
    await expect(restoreConsumedLayers(tx as never, 'org', InventoryDocumentType.SALES, 'inv', DATE, { requireExact: true }))
      .rejects.toThrow('void and replace')
    expect(settlement.unwindSaleSettlements).not.toHaveBeenCalled()
    expect(tx.inventoryLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('supplier-return void cannot put stock beside an uncovered estimate', async () => {
    vi.mocked(settlement.assertNoOutstandingShortfall).mockRejectedValueOnce(new Error('Void that sale or receive stock first'))
    const tx = voidTx([{ id: 'return-entry', itemId: 'item', warehouseId: null, qtyOut: D(1), valueChange: D(-100), lotDraws: [] }])
    await expect(restoreConsumedLayers(tx as never, 'org', InventoryDocumentType.PURCHASE_RETURN, 'pr', DATE)).rejects.toThrow('Void that sale')
    expect(tx.inventoryLot.create).not.toHaveBeenCalled()
  })

  it('receipt void unwinds the document\'s settlements, then re-reads the whole lots it removes', async () => {
    const lot = { id: 'lot-r', itemId: 'item', warehouseId: null, qtyIn: D(2), qtyBalance: D(2), unitCost: D(120), initialValue: D(240),
      carryingValue: D(240), inboundLedgerEntryId: 'inbound-1', documentType: 'PURCHASE', documentId: 'bill-1' }
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ itemId: 'item' }])
      .mockResolvedValueOnce([{ ...lot, qtyBalance: D(0) }])
      .mockResolvedValueOnce([lot])
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      organization: { findUnique: vi.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
      inventoryLot: { findMany, delete: returns({}) },
      inventoryLedgerEntry: { create: returns({}) },
    }
    expect(await reverseAddedLayers(tx as never, 'org', InventoryDocumentType.PURCHASE, 'bill-1', DATE)).toBe(240)
    expect(settlement.unwindReceiptSettlements).toHaveBeenCalledWith(tx, 'org', ['lot-r'], { documentId: 'bill-1', date: DATE })
    expect(tx.inventoryLedgerEntry.create.mock.calls[0][0].data).toMatchObject({ qtyOut: 2, valueChange: -240 })
  })
})
