/**
 * Receipt-date settlement of estimated Weighted Average shortages (finance
 * approval 2026-10-15). The fake transaction keeps settlement rows in memory so
 * successive receipts and reversals see each other; journal numbering and the
 * period guard run for real against it.
 */
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  assertNoOutstandingShortfall, loadShortfallEstimates, outstandingShortfallTotals, settleShortfallsFromReceipt,
  unwindReceiptSettlements, unwindSaleSettlements,
} from '../inventory-shortfall-settlement'

type Row = Record<string, any>
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value)
const DECIMALS = ['quantity', 'estimatedValue', 'actualValue', 'cogsAdjustment']

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some(option => matches(row, option))
    if (key === 'NOT') return !matches(row, condition)
    const value = row[key]
    if (condition === null) return value == null
    if (typeof condition !== 'object') return value === condition
    if ('in' in condition) return condition.in.includes(value)
    if ('notIn' in condition) return value != null && !condition.notIn.includes(value)
    if ('gt' in condition) return value > condition.gt
    throw new Error(`unsupported condition ${key}`)
  })
}

function makeTx(opts: {
  draws: Array<{ id: string; ledgerEntryId?: string; postingSequence: number; quantity: string; costValue: string | null; lotId?: string | null }>
  periodClosed?: boolean
  accounts?: boolean
}) {
  const state = { settlements: [] as Row[], ledger: [] as Row[], lotUpdates: [] as Row[], journals: [] as Row[], periodDates: [] as Date[] }
  const accountsConfigured = opts.accounts !== false
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('AccountingPeriod')) {
        state.periodDates.push(values[1] as Date)
        return opts.periodClosed ? [{ name: 'September 2026', status: 'CLOSED', isLocked: false }] : []
      }
      return [{ max_seq: state.journals.length }]
    }),
    organization: { findUnique: vi.fn(async () => ({ accountDefaults: accountsConfigured ? { inventoryAsset: 'inv', cogsExpense: 'cogs' } : {} })) },
    account: { findMany: vi.fn(async () => accountsConfigured ? [
      { id: 'inv', code: '1310', name: 'Inventory', type: 'ASSET', isActive: true, isPostable: true },
      { id: 'cogs', code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE', isActive: true, isPostable: true },
    ] : []) },
    inventoryLotDraw: { findMany: vi.fn(async () => opts.draws.map(draw => ({
      id: draw.id, ledgerEntryId: draw.ledgerEntryId ?? `sale-${draw.id}`, lotId: draw.lotId ?? null,
      quantity: D(draw.quantity), costValue: draw.costValue == null ? null : D(draw.costValue),
      ledgerEntry: { postingSequence: draw.postingSequence },
      settlements: state.settlements.filter(row => row.saleDrawId === draw.id && row.reversedAt == null),
    }))) },
    inventoryLot: { updateMany: vi.fn(async (args: Row) => { state.lotUpdates.push(args); return { count: 1 } }) },
    inventoryLedgerEntry: { create: vi.fn(async ({ data }: Row) => {
      const row = { id: `move-${state.ledger.length + 1}`, ...data }
      state.ledger.push(row)
      return { id: row.id }
    }) },
    journalEntry: { create: vi.fn(async ({ data }: Row) => {
      state.journals.push(data)
      return { id: `je-${state.journals.length}`, entryNo: data.entryNo }
    }) },
    inventoryShortfallSettlement: {
      create: vi.fn(async ({ data }: Row) => {
        const row: Row = { id: `settlement-${state.settlements.length + 1}`, settlementSequence: state.settlements.length + 1,
          reversedAt: null, reversalLedgerEntryId: null, reversalJournalEntryId: null, ...data }
        for (const key of DECIMALS) row[key] = D(row[key])
        state.settlements.push(row)
        return row
      }),
      findMany: vi.fn(async ({ where }: Row) => state.settlements.filter(row => matches(row, where))
        .sort((a, b) => a.settlementSequence - b.settlementSequence)),
      findFirst: vi.fn(async ({ where }: Row) => state.settlements.find(row => matches(row, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = state.settlements.filter(row => matches(row, where))
        rows.forEach(row => Object.assign(row, data))
        return { count: rows.length }
      }),
    },
  }
  return { tx: tx as never as Prisma.TransactionClient, state }
}

const SALE_DATE = new Date('2026-09-10')
const RECEIPT_DATE = new Date('2026-10-02')
const VOID_DATE = new Date('2026-10-20')
const receipt = (quantity: string, value: string, lotId = 'lot-r', documentId = 'bill-1') => ({
  lotId, inboundLedgerEntryId: `in-${lotId}`, itemId: 'item-1', warehouseId: null, quantity: D(quantity), value: D(value),
  documentType: 'PURCHASE' as const, documentId, date: RECEIPT_DATE,
})
const journalLines = (journal: Row) => journal.lines.create.map((line: Row) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit }))

describe('receipt-date Weighted Average shortage settlement', () => {
  it('posts the approved Dr COGS 40 / Cr Inventory 40 on the receipt date and keeps the 200 estimate', async () => {
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '2', costValue: '200' }] })
    expect(await settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '240'))).toBe(40)

    expect(state.periodDates).toEqual([RECEIPT_DATE])
    // Covered quantity is consumed from the receipt lot; no extra quantity movement.
    expect(state.lotUpdates).toEqual([{ where: { id: 'lot-r', organizationId: 'org-1', qtyBalance: { gte: D('2.0000') } },
      data: { qtyOut: { increment: D('2.0000') }, qtyBalance: { decrement: D('2.0000') } } }])
    expect(state.ledger).toEqual([expect.objectContaining({ documentType: 'SHORTFALL_SETTLEMENT', documentId: 'bill-1',
      date: RECEIPT_DATE, qtyIn: 0, qtyOut: 0, valueChange: D('-40.00') })])
    expect(state.journals).toHaveLength(1)
    expect(state.journals[0]).toMatchObject({ date: RECEIPT_DATE, totalDebit: 40, totalCredit: 40 })
    expect(journalLines(state.journals[0])).toEqual([{ accountId: 'cogs', debit: 40, credit: 0 }, { accountId: 'inv', debit: 0, credit: 40 }])
    expect(state.settlements).toEqual([expect.objectContaining({ saleDrawId: 'draw-1', saleLedgerEntryId: 'sale-draw-1',
      receiptLedgerEntryId: 'in-lot-r', receiptLotId: 'lot-r', adjustmentLedgerEntryId: 'move-1', journalEntryId: 'je-1',
      quantity: D(2), estimatedValue: D(200), actualValue: D(240), cogsAdjustment: D(40) })])
    expect(await outstandingShortfallTotals(tx, 'org-1', 'item-1', null)).toEqual({ quantity: D(0), value: D(0) })
  })

  it('credits COGS for a cheaper receipt and leaves excess quantity on hand at actual cost', async () => {
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '2', costValue: '200' }] })
    expect(await settleShortfallsFromReceipt(tx, 'org-1', receipt('3', '240'))).toBe(-40)
    expect(state.lotUpdates[0].data.qtyBalance).toEqual({ decrement: D(2) })
    expect(state.ledger[0].valueChange).toEqual(D('40.00'))
    expect(journalLines(state.journals[0])).toEqual([{ accountId: 'cogs', debit: 0, credit: 40 }, { accountId: 'inv', debit: 40, credit: 0 }])
    expect(state.settlements[0]).toMatchObject({ quantity: D(2), actualValue: D(160), cogsAdjustment: D(-40) })
  })

  it('settles partial receipts oldest-first with cumulative rounding and no journal for an exact match', async () => {
    const { tx, state } = makeTx({ draws: [
      { id: 'newer', postingSequence: 9, quantity: '1', costValue: '50' },
      { id: 'older', postingSequence: 4, quantity: '3', costValue: '100' },
    ] })
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('1', '33.33', 'lot-a'))
    expect(state.settlements.map(row => [row.saleDrawId, row.estimatedValue.toFixed(2)])).toEqual([['older', '33.33']])
    expect(state.journals).toHaveLength(0)
    expect(state.ledger).toHaveLength(0)
    expect(state.settlements[0].adjustmentLedgerEntryId).toBeNull()

    await settleShortfallsFromReceipt(tx, 'org-1', receipt('3', '150', 'lot-b'))
    expect(state.settlements.slice(1).map(row => [row.saleDrawId, row.quantity.toFixed(4), row.estimatedValue.toFixed(2), row.actualValue.toFixed(2)]))
      .toEqual([['older', '2.0000', '66.67', '100.00'], ['newer', '1.0000', '50.00', '50.00']])
    expect(await outstandingShortfallTotals(tx, 'org-1', 'item-1', null)).toEqual({ quantity: D(0), value: D(0) })
  })

  it('does nothing for an ordinary receipt with no outstanding estimate', async () => {
    const { tx, state } = makeTx({ draws: [] })
    expect(await settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '240'))).toBe(0)
    expect(state).toMatchObject({ lotUpdates: [], ledger: [], journals: [], settlements: [], periodDates: [] })
  })

  it('refuses a receipt dated in a closed period before changing stock', async () => {
    const { tx, state } = makeTx({ periodClosed: true, draws: [{ id: 'draw-1', postingSequence: 7, quantity: '2', costValue: '200' }] })
    await expect(settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '240'))).rejects.toThrow('closed/locked')
    expect(state).toMatchObject({ lotUpdates: [], ledger: [], journals: [], settlements: [] })
  })

  it('refuses without Inventory/COGS accounts before changing stock', async () => {
    const { tx, state } = makeTx({ accounts: false, draws: [{ id: 'draw-1', postingSequence: 7, quantity: '2', costValue: '200' }] })
    await expect(settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '240'))).rejects.toThrow('Inventory Asset and COGS')
    expect(state).toMatchObject({ lotUpdates: [], ledger: [], journals: [] })
  })

  it('treats untracked or inconsistent shortage history as requiring review', async () => {
    const legacy = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '2', costValue: null }] })
    await expect(loadShortfallEstimates(legacy.tx, 'org-1', 'item-1', null)).rejects.toThrow('Review')
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '3', costValue: '100' }] })
    state.settlements.push({ id: 'bad', settlementSequence: 1, saleDrawId: 'draw-1', reversedAt: null, quantity: D(1), estimatedValue: D('40') })
    await expect(settleShortfallsFromReceipt(tx, 'org-1', receipt('1', '40'))).rejects.toThrow('requires review')
    expect(state.lotUpdates).toEqual([])
  })
})

describe('reversing shortage settlements', () => {
  it('receipt void releases the covered quantity and reverses the difference on the void date', async () => {
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '2', costValue: '200' }] })
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '240'))
    expect(await unwindReceiptSettlements(tx, 'org-1', ['lot-r'], { documentId: 'bill-1', date: VOID_DATE })).toBe(40)

    expect(state.periodDates).toEqual([RECEIPT_DATE, VOID_DATE])
    expect(state.lotUpdates[1]).toEqual({ where: { id: 'lot-r', organizationId: 'org-1', qtyOut: { gte: D(2) } },
      data: { qtyOut: { decrement: D(2) }, qtyBalance: { increment: D(2) } } })
    expect(state.ledger[1]).toMatchObject({ documentType: 'SHORTFALL_SETTLEMENT', documentId: 'bill-1', date: VOID_DATE,
      qtyIn: 0, qtyOut: 0, valueChange: D(40), reversesLedgerEntryId: 'move-1' })
    expect(state.journals[1]).toMatchObject({ date: VOID_DATE, source: 'REVERSAL' })
    expect(journalLines(state.journals[1])).toEqual([{ accountId: 'cogs', debit: 0, credit: 40 }, { accountId: 'inv', debit: 40, credit: 0 }])
    expect(state.settlements[0]).toMatchObject({ reversedAt: VOID_DATE, reversalLedgerEntryId: 'move-2', reversalJournalEntryId: 'je-2' })
    // The original estimate is outstanding again, unchanged.
    expect(await outstandingShortfallTotals(tx, 'org-1', 'item-1', null)).toEqual({ quantity: D(2), value: D(200) })
  })

  it('refuses to void an earlier receipt when a later one settled the rest of the same sale', async () => {
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '3', costValue: '100' }] })
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('1', '40', 'lot-a', 'bill-a'))
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '80', 'lot-b', 'bill-b'))
    await expect(unwindReceiptSettlements(tx, 'org-1', ['lot-a'], { documentId: 'bill-a', date: VOID_DATE })).rejects.toThrow('Reverse that receipt first')
    expect(state.settlements.every(row => row.reversedAt == null)).toBe(true)
    // Newest first succeeds, and one document's lots unwind together.
    await unwindReceiptSettlements(tx, 'org-1', ['lot-b'], { documentId: 'bill-b', date: VOID_DATE })
    await unwindReceiptSettlements(tx, 'org-1', ['lot-a'], { documentId: 'bill-a', date: VOID_DATE })
    expect(await outstandingShortfallTotals(tx, 'org-1', 'item-1', null)).toEqual({ quantity: D(3), value: D(100) })
  })

  it('lets one receipt document with two lots settle and unwind the same sale', async () => {
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '3', costValue: '300' }] })
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '220', 'lot-1'))
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('2', '220', 'lot-2'))
    expect(await unwindReceiptSettlements(tx, 'org-1', ['lot-1', 'lot-2'], { documentId: 'bill-1', date: VOID_DATE })).toBe(30)
    expect(state.journals).toHaveLength(3)
    expect(state.settlements.every(row => row.reversedAt === VOID_DATE)).toBe(true)
  })

  it('sale void unwinds every settlement of its draws in one reversal journal', async () => {
    const { tx, state } = makeTx({ draws: [{ id: 'draw-1', postingSequence: 7, quantity: '3', costValue: '300' }] })
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('1', '120', 'lot-a'))
    await settleShortfallsFromReceipt(tx, 'org-1', receipt('1', '80', 'lot-b'))
    expect(await unwindSaleSettlements(tx, 'org-1', ['draw-1'], { documentId: 'invoice-1', date: VOID_DATE })).toBe(0)
    // +20 and -20 net to zero: both lots are released, no journal is needed.
    expect(state.journals).toHaveLength(2)
    expect(state.lotUpdates.slice(2).map(update => update.where.id)).toEqual(['lot-a', 'lot-b'])
    expect(state.ledger.slice(2).map(row => [row.documentId, row.valueChange.toFixed(2)])).toEqual([['invoice-1', '20.00'], ['invoice-1', '-20.00']])
  })

  it('refuses to restore stock beside another sale\'s uncovered estimate', async () => {
    const { tx } = makeTx({ draws: [
      { id: 'mine', ledgerEntryId: 'sale-mine', postingSequence: 3, quantity: '2', costValue: '200' },
      { id: 'other', ledgerEntryId: 'sale-other', postingSequence: 5, quantity: '1', costValue: '100' },
    ] })
    await expect(assertNoOutstandingShortfall(tx, 'org-1', 'item-1', null, ['sale-mine'])).rejects.toThrow('Void that sale')
    const alone = makeTx({ draws: [{ id: 'mine', ledgerEntryId: 'sale-mine', postingSequence: 3, quantity: '2', costValue: '200' }] })
    await expect(assertNoOutstandingShortfall(alone.tx, 'org-1', 'item-1', null, ['sale-mine'])).resolves.toBeUndefined()
  })
})
