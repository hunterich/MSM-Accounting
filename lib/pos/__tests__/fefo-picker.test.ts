import { describe, expect, it } from 'vitest';
import { pickFefo, type BatchAvailability } from '../fefo-picker';

const batches: BatchAvailability[] = [
  { stockBatchId: 'b-late', expiryDate: new Date('2027-06-01'), qtyOnHand: 50 },
  { stockBatchId: 'b-early', expiryDate: new Date('2026-09-01'), qtyOnHand: 30 },
  { stockBatchId: 'b-mid', expiryDate: new Date('2027-01-01'), qtyOnHand: 20 },
];

describe('pickFefo', () => {
  it('allocates from the earliest expiry first', () => {
    const res = pickFefo(batches, 40);
    expect(res.ok).toBe(true);
    expect(res.allocations).toEqual([
      { stockBatchId: 'b-early', qty: 30 },
      { stockBatchId: 'b-mid', qty: 10 },
    ]);
  });

  it('allocates from a single batch when it suffices', () => {
    const res = pickFefo(batches, 25);
    expect(res.allocations).toEqual([{ stockBatchId: 'b-early', qty: 25 }]);
  });

  it('fails when total available is less than requested', () => {
    const res = pickFefo(batches, 200);
    expect(res.ok).toBe(false);
    expect(res.allocations).toEqual([]);
    expect(res.shortBy).toBe(100);
  });

  it('ignores batches with no stock', () => {
    const res = pickFefo([{ stockBatchId: 'empty', expiryDate: new Date('2026-01-01'), qtyOnHand: 0 }], 5);
    expect(res.ok).toBe(false);
    expect(res.shortBy).toBe(5);
  });
});
