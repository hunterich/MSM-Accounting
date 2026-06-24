/**
 * voidStockAdjustment reverses the adjustment's variance journal entry (resolved
 * by memo) and unwinds both inventory directions — removes the increase layers it
 * added (reverseAddedLayers) and restores the decrease draw-downs it consumed
 * (restoreConsumedLayers) — then marks VOID. Increases must be reversed BEFORE
 * restoring decreases, so the restored layers aren't picked up by the removal.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-REV' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../inventory-costing', () => ({
  reverseAddedLayers: vi.fn(async () => 300),
  restoreConsumedLayers: vi.fn(async () => 200),
}));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { reverseAddedLayers, restoreConsumedLayers } from '../inventory-costing';
import { voidStockAdjustment } from '../stock-adjustment-void';

const DATE = new Date('2026-06-20');

function makeTx(adj: any, entry: any = { id: 'je-1' }) {
  return {
    stockAdjustment: { findFirst: vi.fn(async () => adj), update: vi.fn(async () => ({})) },
    journalEntry: { findFirst: vi.fn(async () => entry) },
  };
}
const adj = (over: any = {}) => ({ id: 'adj-1', number: 'ADJ-0001', status: 'APPROVED', ...over });

describe('voidStockAdjustment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the variance JE, unwinds both directions, and marks VOID', async () => {
    const tx = makeTx(adj());
    await voidStockAdjustment(tx as never, 'org-a', 'adj-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(tx.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'POSTED', memo: 'Stock adjustment: ADJ-0001' }) }),
    );
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect(reverseAddedLayers).toHaveBeenCalledWith(tx, 'org-a', 'ADJUSTMENT', 'adj-1', DATE);
    expect(restoreConsumedLayers).toHaveBeenCalledWith(tx, 'org-a', 'ADJUSTMENT', 'adj-1', DATE);
    expect((tx.stockAdjustment.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('removes increases before restoring decreases', async () => {
    const tx = makeTx(adj());
    await voidStockAdjustment(tx as never, 'org-a', 'adj-1', { date: DATE });
    const removeOrder = (reverseAddedLayers as any).mock.invocationCallOrder[0];
    const restoreOrder = (restoreConsumedLayers as any).mock.invocationCallOrder[0];
    expect(removeOrder).toBeLessThan(restoreOrder);
  });

  it('throws 404 when missing', async () => {
    const tx = makeTx(null);
    await expect(voidStockAdjustment(tx as never, 'org-a', 'x', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseAddedLayers).not.toHaveBeenCalled();
  });

  it('refuses an already-voided adjustment', async () => {
    const tx = makeTx(adj({ status: 'VOID' }));
    await expect(voidStockAdjustment(tx as never, 'org-a', 'adj-1', { date: DATE })).rejects.toThrow(/already void/i);
  });

  it('skips JE reversal when no variance entry exists (net-zero adjustment) but still unwinds + voids', async () => {
    const tx = makeTx(adj(), null);
    await voidStockAdjustment(tx as never, 'org-a', 'adj-1', { date: DATE });
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(reverseAddedLayers).toHaveBeenCalled();
    expect(restoreConsumedLayers).toHaveBeenCalled();
    expect((tx.stockAdjustment.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });
});
