/**
 * The carrying-value refresh behind every Weighted Average write accepts a
 * negative pool only when it is exactly the tracked, uncovered sale estimates.
 */
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { previewInventoryCarryingValues } from '../inventory-carrying-preview'

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value)

function makeTx(opts: {
  pool: { qtyIn: string; qtyOut: string; value: string }
  lots: Array<{ id: string; qtyBalance: string }>
  draws?: Array<{ quantity: string; costValue: string | null; settled?: Array<{ quantity: string; estimatedValue: string }> }>
}) {
  return {
    inventoryLedgerEntry: { aggregate: vi.fn(async () => ({ _sum: { qtyIn: D(opts.pool.qtyIn), qtyOut: D(opts.pool.qtyOut), valueChange: D(opts.pool.value) } })) },
    inventoryLot: { findMany: vi.fn(async () => opts.lots.map(lot => ({ ...lot, warehouseId: null, qtyBalance: D(lot.qtyBalance), unitCost: D(100) }))) },
    inventoryLotDraw: { findMany: vi.fn(async () => (opts.draws ?? []).map((draw, index) => ({
      id: `draw-${index}`, ledgerEntryId: `sale-${index}`, lotId: null, quantity: D(draw.quantity),
      costValue: draw.costValue == null ? null : D(draw.costValue), ledgerEntry: { postingSequence: index },
      settlements: (draw.settled ?? []).map(row => ({ quantity: D(row.quantity), estimatedValue: D(row.estimatedValue) })),
    }))) },
  }
}

describe('carrying-value preview with estimated shortages', () => {
  it('accepts the approved 5 received / 7 sold pool at -2 / -200 with nothing on hand', async () => {
    const tx = makeTx({ pool: { qtyIn: '5', qtyOut: '7', value: '-200' }, lots: [{ id: 'lot-a', qtyBalance: '0' }],
      draws: [{ quantity: '2', costValue: '200' }] })
    expect(await previewInventoryCarryingValues(tx as never, 'org', 'item', null)).toMatchObject({
      ledgerQuantity: '-2.0000', bookValue: '-200.00', physicalQuantity: '0.0000',
      outstandingShortfallQuantity: '2.0000', outstandingShortfallEstimate: '200.00',
      lots: [{ id: 'lot-a', proposedCarryingValue: '0.00' }],
    })
  })

  it('accepts a partly settled shortage and reports only the uncovered estimate', async () => {
    const tx = makeTx({ pool: { qtyIn: '6', qtyOut: '7', value: '-33.33' }, lots: [],
      draws: [{ quantity: '3', costValue: '100', settled: [{ quantity: '2', estimatedValue: '66.67' }] }] })
    expect(await previewInventoryCarryingValues(tx as never, 'org', 'item', null)).toMatchObject({ outstandingShortfallQuantity: '1.0000', outstandingShortfallEstimate: '33.33' })
  })

  it.each([
    ['legacy negative stock without estimates', { pool: { qtyIn: '5', qtyOut: '7', value: '-200' }, lots: [], draws: [] }],
    ['estimate that differs from the pool value', { pool: { qtyIn: '5', qtyOut: '7', value: '-190' }, lots: [], draws: [{ quantity: '2', costValue: '200' }] }],
    ['stock on hand beside a negative pool', { pool: { qtyIn: '5', qtyOut: '7', value: '-200' }, lots: [{ id: 'lot-a', qtyBalance: '1' }], draws: [{ quantity: '2', costValue: '200' }] }],
  ])('refuses %s for review', async (_label, opts) => {
    await expect(previewInventoryCarryingValues(makeTx(opts) as never, 'org', 'item', null)).rejects.toThrow('requires review')
  })

  it('refuses an uncovered estimate beside non-negative stock', async () => {
    const tx = makeTx({ pool: { qtyIn: '3', qtyOut: '2', value: '100' }, lots: [{ id: 'lot-a', qtyBalance: '1' }], draws: [{ quantity: '2', costValue: '200' }] })
    await expect(previewInventoryCarryingValues(tx as never, 'org', 'item', null)).rejects.toThrow('requires reconciliation')
  })

  it('keeps ordinary positive pools unchanged', async () => {
    const tx = makeTx({ pool: { qtyIn: '3', qtyOut: '0', value: '100' }, lots: [{ id: 'a', qtyBalance: '1' }, { id: 'b', qtyBalance: '2' }] })
    expect((await previewInventoryCarryingValues(tx as never, 'org', 'item', null)).lots.map(lot => lot.proposedCarryingValue)).toEqual(['33.33', '66.67'])
  })
})
