import { describe, expect, it } from 'vitest'
import { allocateShortfallReceipt, type EstimatedShortfall } from '../inventory-shortfall-allocation'

const estimate = (id = 'sale', quantity = '2', estimatedValue = '200'): EstimatedShortfall => ({ id, quantity, estimatedValue, settledQuantity: '0', settledEstimatedValue: '0' })
describe('receipt-date shortfall cost adjustment', () => {
  it('books the approved 40 cost increase without changing the original 200 estimate', () => {
    const original = estimate(), before = { ...original }
    expect(allocateShortfallReceipt('2', '240', [original])).toEqual({ allocations: [
      { shortfallId: 'sale', quantity: '2.0000', estimatedValue: '200.00', actualValue: '240.00', cogsAdjustment: '40.00' },
    ], coveredQuantity: '2.0000', remainingQuantity: '0.0000', remainingValue: '0.00', cogsAdjustment: '40.00' })
    expect(original).toEqual(before)
  })
  it('leaves extra received stock at actual receipt cost', () => {
    expect(allocateShortfallReceipt('3', '360', [estimate()])).toMatchObject({ coveredQuantity: '2.0000', remainingQuantity: '1.0000', remainingValue: '120.00', cogsAdjustment: '40.00' })
  })
  it('reduces COGS for a cheaper receipt', () => {
    expect(allocateShortfallReceipt('2', '160', [estimate()]).cogsAdjustment).toBe('-40.00')
  })
  it('handles partial receipts and closes the original estimate exactly', () => {
    const row = estimate('sale', '3', '100')
    expect(allocateShortfallReceipt('1', '40', [row]).allocations[0]).toMatchObject({ estimatedValue: '33.33', cogsAdjustment: '6.67' })
    const next = { ...row, settledQuantity: '1', settledEstimatedValue: '33.33' }
    expect(allocateShortfallReceipt('1', '40', [next]).allocations[0]).toMatchObject({ estimatedValue: '33.34', cogsAdjustment: '6.66' })
    expect(allocateShortfallReceipt('1', '40', [{ ...row, settledQuantity: '2', settledEstimatedValue: '66.67' }]).allocations[0]).toMatchObject({ estimatedValue: '33.33', cogsAdjustment: '6.67' })
  })
  it('distributes one receipt over multiple older estimates with exact monetary exhaustion', () => {
    const result = allocateShortfallReceipt('3', '100', [estimate('older', '1', '30'), estimate('newer', '2', '60')])
    expect(result.allocations.map(row => row.actualValue)).toEqual(['33.33', '66.67'])
    expect(result.cogsAdjustment).toBe('10.00'); expect(result.remainingValue).toBe('0.00')
  })
  it('handles fractional quantities and zero-priced receipts', () => {
    expect(allocateShortfallReceipt('0.25', '0', [estimate('fraction', '0.5', '10')])).toMatchObject({ coveredQuantity: '0.2500', remainingValue: '0.00', cogsAdjustment: '-5.00' })
  })
  it('keeps an ordinary receipt intact when no shortage is outstanding', () => {
    expect(allocateShortfallReceipt('3', '1000', [])).toEqual({ allocations: [], coveredQuantity: '0.0000', remainingQuantity: '3.0000', remainingValue: '1000.00', cogsAdjustment: '0.00' })
  })
  it.each([
    { ...estimate(), settledQuantity: '3' },
    { ...estimate(), settledQuantity: '1', settledEstimatedValue: '99.99' },
    { ...estimate(), quantity: '0' },
  ])('refuses inconsistent prior settlement rather than inventing a difference', row => {
    expect(() => allocateShortfallReceipt('1', '100', [row])).toThrow('requires reconciliation')
  })
  it('validates IDs and monetary/quantity scales even after receipt is exhausted', () => {
    expect(() => allocateShortfallReceipt('2', '240', [estimate(), estimate()])).toThrow('unique')
    expect(() => allocateShortfallReceipt('0', '0', [])).toThrow('positive')
    expect(() => allocateShortfallReceipt('1', '-1', [])).toThrow('Invalid')
    expect(() => allocateShortfallReceipt('1.00001', '1', [])).toThrow('Invalid')
    expect(() => allocateShortfallReceipt('1', '1.001', [])).toThrow('Invalid')
  })
})
