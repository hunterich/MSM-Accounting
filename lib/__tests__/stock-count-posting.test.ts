import { describe, it, expect } from 'vitest';
import { buildCountAdjustmentLines } from '../stock-count-posting';

const line = (itemId: string, systemQty: number, countedQty: number | null, unitCost = 1000) => ({
  itemId, systemQty, countedQty, unitCost,
});

describe('buildCountAdjustmentLines', () => {
  it('skips lines with no counted quantity (blank = not counted)', () => {
    const out = buildCountAdjustmentLines([line('a', 10, null)], { a: 10 });
    expect(out).toEqual([]);
  });

  it('skips zero-variance lines (counted equals live)', () => {
    const out = buildCountAdjustmentLines([line('a', 10, 8)], { a: 8 });
    expect(out).toEqual([]);
  });

  it('values the variance against LIVE on-hand, not the snapshot', () => {
    // snapshot systemQty was 10, but live is 9 (a sale happened); counted 7.
    const out = buildCountAdjustmentLines([line('a', 10, 7)], { a: 9 });
    expect(out).toEqual([{ itemId: 'a', oldQty: 9, newQty: 7, qtyDiff: -2, unitCost: 1000 }]);
  });

  it('handles a mix of up, down, blank, and zero in one batch', () => {
    const out = buildCountAdjustmentLines(
      [line('up', 5, 8), line('down', 10, 6), line('blank', 3, null), line('same', 4, 4)],
      { up: 5, down: 10, blank: 3, same: 4 },
    );
    expect(out).toEqual([
      { itemId: 'up', oldQty: 5, newQty: 8, qtyDiff: 3, unitCost: 1000 },
      { itemId: 'down', oldQty: 10, newQty: 6, qtyDiff: -4, unitCost: 1000 },
    ]);
  });

  it('treats a missing live entry as 0 on hand', () => {
    const out = buildCountAdjustmentLines([line('a', 0, 5)], {});
    expect(out).toEqual([{ itemId: 'a', oldQty: 0, newQty: 5, qtyDiff: 5, unitCost: 1000 }]);
  });
});
