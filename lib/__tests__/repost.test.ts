import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-000099' })) }));
vi.mock('../inventory-costing', () => ({
  reversePurchaseLayers: vi.fn(async () => undefined),
  restoreConsumedLayers: vi.fn(async () => undefined),
}));

import { reverseBillPosting, reverseInvoicePosting } from '../repost';
import { reverseJournalEntry } from '../reverse-journal-entry';
import { reversePurchaseLayers, restoreConsumedLayers } from '../inventory-costing';

const DATE = new Date('2026-06-30');

describe('reverseBillPosting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('reverses the tracked journal entry and the cost layers for a standalone bill', async () => {
    const tx = { journalEntry: { findFirst: vi.fn() } } as never;
    await reverseBillPosting(tx, 'org-a', { id: 'bill-1', number: 'BILL-0001', poId: null, journalEntryId: 'je-1' }, { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect(reversePurchaseLayers).toHaveBeenCalledWith(tx, 'org-a', 'bill-1', DATE);
  });

  it('leaves inventory alone for a PO-sourced bill (GR/IR, no own layers)', async () => {
    const tx = { journalEntry: { findFirst: vi.fn() } } as never;
    await reverseBillPosting(tx, 'org-a', { id: 'bill-1', number: 'BILL-0001', poId: 'po-1', journalEntryId: 'je-1' }, { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledTimes(1);
    expect(reversePurchaseLayers).not.toHaveBeenCalled();
  });

  it('falls back to the posting entry by memo when journalEntryId is missing', async () => {
    const tx = { journalEntry: { findFirst: vi.fn(async () => ({ id: 'je-legacy' })) } } as never;
    await reverseBillPosting(tx, 'org-a', { id: 'bill-1', number: 'BILL-0001', poId: null, journalEntryId: null }, { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-legacy', expect.anything());
  });

  it('throws when no posting entry can be found (nothing to reverse)', async () => {
    const tx = { journalEntry: { findFirst: vi.fn(async () => null) } } as never;
    await expect(
      reverseBillPosting(tx, 'org-a', { id: 'bill-1', number: 'BILL-0001', poId: null, journalEntryId: null }, { date: DATE }),
    ).rejects.toThrow(/nothing to reverse/i);
  });
});

describe('reverseInvoicePosting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('reverses both AR + COGS entries and restores the sold stock', async () => {
    const tx = { journalEntry: { findMany: vi.fn(async () => [{ id: 'je-ar' }, { id: 'je-cogs' }]) } } as never;
    await reverseInvoicePosting(tx, 'org-a', { id: 'inv-1', number: 'INV-0001' }, { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledTimes(2);
    expect(restoreConsumedLayers).toHaveBeenCalledWith(tx, 'org-a', 'SALES', 'inv-1', DATE);
  });
});
