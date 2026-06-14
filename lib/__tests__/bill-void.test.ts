/**
 * voidBill reverses a posted bill's GL entry, unwinds inventory it booked
 * directly (non-PO bills only), and marks the bill VOID — with guards against
 * voiding drafts, already-voided, paid, or settled bills.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-000099' })) }));
vi.mock('../inventory-costing', () => ({ reversePurchaseLayers: vi.fn(async () => undefined) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { reversePurchaseLayers } from '../inventory-costing';
import { assertPeriodOpen } from '../period-guard';
import { voidBill } from '../bill-void';

const DATE = new Date('2026-06-14');

function makeTx(bill: any, jeByMemo: any = null) {
  return {
    bill: { findFirst: vi.fn(async () => bill), update: vi.fn(async () => ({})) },
    journalEntry: { findFirst: vi.fn(async () => jeByMemo) },
  };
}

const posted = (over: any = {}) => ({
  id: 'bill-1', number: 'BILL-0001', status: 'OPEN', poId: null,
  journalEntryId: 'je-1', voidedAt: null, deletedAt: null, issueDate: '2026-06-01',
  paymentAllocations: [], ...over,
});

describe('voidBill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the posting JE, removes the inventory it booked, and marks VOID (non-PO bill)', async () => {
    const tx = makeTx(posted());
    await voidBill(tx as never, 'org-a', 'bill-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect(reversePurchaseLayers).toHaveBeenCalledWith(tx, 'org-a', 'bill-1', DATE);
    const upd = (tx.bill.update as any).mock.calls[0][0];
    expect(upd.data).toMatchObject({ status: 'VOID' });
    expect(upd.data.voidedAt).toBeInstanceOf(Date);
  });

  it('leaves inventory alone for a PO-sourced bill (the layer belongs to the receipt)', async () => {
    const tx = makeTx(posted({ poId: 'po-1' }));
    await voidBill(tx as never, 'org-a', 'bill-1', { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledTimes(1);
    expect(reversePurchaseLayers).not.toHaveBeenCalled();
  });

  it('falls back to finding the posting JE by memo for a legacy bill', async () => {
    const tx = makeTx(posted({ journalEntryId: null }), { id: 'je-legacy' });
    await voidBill(tx as never, 'org-a', 'bill-1', { date: DATE });
    expect(tx.journalEntry.findFirst).toHaveBeenCalled();
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-legacy', expect.anything());
  });

  it('throws 404 when the bill does not exist', async () => {
    const tx = makeTx(null);
    await expect(voidBill(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses to void a DRAFT bill (delete instead)', async () => {
    const tx = makeTx(posted({ status: 'DRAFT', journalEntryId: null }));
    await expect(voidBill(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/draft/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(tx.bill.update).not.toHaveBeenCalled();
  });

  it('refuses to void an already-voided bill', async () => {
    const tx = makeTx(posted({ status: 'VOID', voidedAt: '2026-06-10' }));
    await expect(voidBill(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/already void/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses to void a PAID bill', async () => {
    const tx = makeTx(posted({ status: 'PAID' }));
    await expect(voidBill(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/paid|payment/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses to void a bill that has payment allocations', async () => {
    const tx = makeTx(posted({ paymentAllocations: [{ id: 'alloc-1' }] }));
    await expect(voidBill(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/payment/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('throws when no posting entry can be found (nothing was posted)', async () => {
    const tx = makeTx(posted({ journalEntryId: null }), null);
    await expect(voidBill(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/no posting|not posted|posting entry/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });
});
