import { describe, expect, it } from 'vitest'
import { allocateInventoryCarryingValue as allocate } from '../inventory-carrying-allocation'

describe('Weighted Average lot carrying allocation', () => {
  it('allocates remaining 6,600 over one and five units without using receipt prices', () => {
    expect(allocate([{ id: 'old', quantity: '1' }, { id: 'new', quantity: '5' }], '6600')).toEqual([
      { id: 'new', carryingValue: '5500.00' }, { id: 'old', carryingValue: '1100.00' },
    ])
  })

  it('preserves fractional quantities and assigns the largest remainder the extra cent', () => {
    expect(allocate([{ id: 'A', quantity: '0.0001' }, { id: 'B', quantity: '0.0002' }], '0.01')).toEqual([
      { id: 'A', carryingValue: '0.00' }, { id: 'B', carryingValue: '0.01' },
    ])
  })

  it('breaks equal remainders by ID and is independent of input order', () => {
    const lots = [{ id: 'C', quantity: '1' }, { id: 'A', quantity: '1' }, { id: 'B', quantity: '1' }]
    const expected = [{ id: 'A', carryingValue: '0.34' }, { id: 'B', carryingValue: '0.33' }, { id: 'C', carryingValue: '0.33' }]
    expect(allocate(lots, '1')).toEqual(expected)
    expect(allocate([...lots].reverse(), '1')).toEqual(expected)
  })

  it('never allocates residual cents to depleted lots', () => {
    expect(allocate([{ id: 'A', quantity: '0' }, { id: 'B', quantity: '2' }], '0.01')).toEqual([
      { id: 'A', carryingValue: '0.00' }, { id: 'B', carryingValue: '0.01' },
    ])
  })

  it('conserves values beyond JavaScript safe-integer precision exactly', () => {
    expect(allocate([{ id: 'A', quantity: '1' }, { id: 'B', quantity: '1' }], '9999999999999999.99')).toEqual([
      { id: 'A', carryingValue: '5000000000000000.00' }, { id: 'B', carryingValue: '4999999999999999.99' },
    ])
  })

  it('supports zero-cost and exhausted pools but refuses value without quantity', () => {
    expect(allocate([], '0')).toEqual([])
    expect(allocate([{ id: 'A', quantity: '4' }], '0')).toEqual([{ id: 'A', carryingValue: '0.00' }])
    expect(() => allocate([], '0.01')).toThrow('without stock')
    expect(() => allocate([{ id: 'A', quantity: '0' }], '1')).toThrow('without stock')
  })

  it.each(['-1', 'NaN', 'Infinity', '', '1e2', ' 1', '1.001', '10000000000000000.00'])('refuses invalid book value %s', value => {
    expect(() => allocate([{ id: 'A', quantity: '1' }], value)).toThrow()
  })

  it.each(['-1', 'NaN', '1.00001', '100000000000'])('refuses invalid quantity %s', quantity => {
    expect(() => allocate([{ id: 'A', quantity }], '1')).toThrow()
  })

  it('refuses ambiguous identifiers', () => {
    expect(() => allocate([{ id: '', quantity: '1' }], '1')).toThrow('identifiers')
    expect(() => allocate([{ id: 'A', quantity: '1' }, { id: 'A', quantity: '2' }], '1')).toThrow('identifiers')
  })
})
