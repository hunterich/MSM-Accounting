/**
 * voidStockCountForAdjustment cascades an adjustment void back to the StockCount
 * that generated it: a POSTED count whose generatedAdjustmentId matches is moved
 * to VOIDED so its status + journal stop contradicting the reversed GL. No-op
 * for adjustments that no count generated, or counts not in POSTED.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { voidStockCountForAdjustment } from '../stock-count-void';

function makeTx(count: any) {
  return {
    stockCount: {
      findFirst: vi.fn(async () => count),
      update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
  };
}

describe('voidStockCountForAdjustment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a POSTED owning count VOIDED and returns its id', async () => {
    const tx = makeTx({ id: 'sc-1', status: 'POSTED' });
    const result = await voidStockCountForAdjustment(tx as never, 'org-a', 'adj-1');

    expect(tx.stockCount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { generatedAdjustmentId: 'adj-1', organizationId: 'org-a' },
      }),
    );
    expect(tx.stockCount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sc-1' }, data: { status: 'VOIDED' } }),
    );
    expect(result).toBe('sc-1');
  });

  it('is a no-op when no count generated the adjustment', async () => {
    const tx = makeTx(null);
    const result = await voidStockCountForAdjustment(tx as never, 'org-a', 'adj-1');

    expect(tx.stockCount.update).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('is a no-op when the owning count is not POSTED', async () => {
    const tx = makeTx({ id: 'sc-1', status: 'CANCELLED' });
    const result = await voidStockCountForAdjustment(tx as never, 'org-a', 'adj-1');

    expect(tx.stockCount.update).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
