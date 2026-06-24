/**
 * voidInvoice reverses the invoice's AR + COGS journal entries (resolved by
 * memo), un-consumes the sold stock, and marks the invoice VOID. Refuses
 * unposted, already-void, paid, or receipt-allocated invoices.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-REV' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../inventory-costing', () => ({ restoreConsumedLayers: vi.fn(async () => 400) }));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { restoreConsumedLayers } from '../inventory-costing';
import { voidInvoice } from '../invoice-void';

const DATE = new Date('2026-06-20');

function makeTx(invoice: any, entries: any[] = []) {
  return {
    salesInvoice: { findFirst: vi.fn(async () => invoice), update: vi.fn(async () => ({})) },
    journalEntry: { findMany: vi.fn(async () => entries) },
  };
}
const sent = (over: any = {}) => ({ id: 'inv-1', number: 'INV-0001', status: 'SENT', paymentAllocations: [], ...over });

describe('voidInvoice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses every posting entry, un-consumes stock, and marks VOID', async () => {
    const tx = makeTx(sent(), [{ id: 'je-ar' }, { id: 'je-cogs' }]);
    await voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(tx.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'POSTED', memo: { in: ['Sales recognition: INV-0001', 'COGS auto-post: INV-0001'] } }),
      }),
    );
    expect(reverseJournalEntry).toHaveBeenCalledTimes(2);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-ar', expect.objectContaining({ date: DATE }));
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-cogs', expect.objectContaining({ date: DATE }));
    expect(restoreConsumedLayers).toHaveBeenCalledWith(tx, 'org-a', 'SALES', 'inv-1', DATE);
    expect((tx.salesInvoice.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('throws 404 when the invoice does not exist', async () => {
    const tx = makeTx(null);
    await expect(voidInvoice(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an already-voided invoice', async () => {
    const tx = makeTx(sent({ status: 'VOID' }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/already void/i);
  });

  it('refuses a draft invoice — delete it instead', async () => {
    const tx = makeTx(sent({ status: 'DRAFT' }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(restoreConsumedLayers).not.toHaveBeenCalled();
  });

  it('refuses a paid invoice', async () => {
    const tx = makeTx(sent({ status: 'PAID' }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/paid/i);
  });

  it('refuses an invoice with receipts applied', async () => {
    const tx = makeTx(sent({ paymentAllocations: [{ id: 'alloc-1' }] }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/receipt|payment|applied|unallocate/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });
});
