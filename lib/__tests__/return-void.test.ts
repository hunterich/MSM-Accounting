/**
 * voidSalesReturn / voidPurchaseReturn reverse a posted return's inventory JE
 * and unwind the stock it moved (sales return removes its restock; purchase
 * return restores its draw-down), then mark VOID. Refuse draft, already-void,
 * and returns with an APPLIED linked note.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-REV' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../inventory-costing', () => ({
  reverseAddedLayers: vi.fn(async () => 500),
  restoreConsumedLayers: vi.fn(async () => 500),
}));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { reverseAddedLayers, restoreConsumedLayers } from '../inventory-costing';
import { voidSalesReturn, voidPurchaseReturn } from '../return-void';

const DATE = new Date('2026-06-20');

function makeSrTx(ret: any) {
  return { salesReturn: { findFirst: vi.fn(async () => ret), updateMany: vi.fn(async () => ({ count: 1 })) } };
}
function makePrTx(ret: any) {
  return { purchaseReturn: { findFirst: vi.fn(async () => ret), updateMany: vi.fn(async () => ({ count: 1 })) } };
}
const sr = (over: any = {}) => ({ id: 'sr-1', number: 'SR-0001', status: 'APPROVED', journalEntryId: 'je-1', creditNotes: [], ...over });
const pr = (over: any = {}) => ({ id: 'pr-1', number: 'PR-0001', status: 'APPROVED', journalEntryId: 'je-2', debitNotes: [], ...over });

describe('voidSalesReturn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE, removes the restock, and marks VOID', async () => {
    const tx = makeSrTx(sr());
    await voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE });
    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect(reverseAddedLayers).toHaveBeenCalledWith(tx, 'org-a', 'SALES_RETURN', 'sr-1', DATE);
    expect((tx.salesReturn.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ status: { not: 'VOID' } }),
      data: { status: 'VOID' },
    });
  });

  it('throws 404 when missing', async () => {
    const tx = makeSrTx(null);
    await expect(voidSalesReturn(tx as never, 'org-a', 'x', { date: DATE })).rejects.toThrow(/not found/i);
  });

  it('refuses an already-voided return', async () => {
    const tx = makeSrTx(sr({ status: 'VOID' }));
    await expect(voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE })).rejects.toThrow(/already void/i);
  });

  it('refuses a draft return — delete instead', async () => {
    const tx = makeSrTx(sr({ status: 'DRAFT', journalEntryId: null }));
    await expect(voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(reverseAddedLayers).not.toHaveBeenCalled();
  });

  it('refuses a return with an applied credit note', async () => {
    const tx = makeSrTx(sr({ creditNotes: [{ id: 'cn-1' }] }));
    await expect(voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE })).rejects.toThrow(/credit note/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('skips JE reversal for a services-only return (no journalEntryId) but still unwinds + voids', async () => {
    const tx = makeSrTx(sr({ journalEntryId: null }));
    await voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE });
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(reverseAddedLayers).toHaveBeenCalled();
    expect((tx.salesReturn.updateMany as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });
});

describe('voidPurchaseReturn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE, restores the removed stock, and marks VOID', async () => {
    const tx = makePrTx(pr());
    await voidPurchaseReturn(tx as never, 'org-a', 'pr-1', { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-2', expect.objectContaining({ date: DATE }));
    expect(restoreConsumedLayers).toHaveBeenCalledWith(tx, 'org-a', 'PURCHASE_RETURN', 'pr-1', DATE);
    expect((tx.purchaseReturn.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ status: { not: 'VOID' } }),
      data: { status: 'VOID' },
    });
  });

  it('refuses a return with an applied debit note', async () => {
    const tx = makePrTx(pr({ debitNotes: [{ id: 'dn-1' }] }));
    await expect(voidPurchaseReturn(tx as never, 'org-a', 'pr-1', { date: DATE })).rejects.toThrow(/debit note/i);
  });

  it('skips JE reversal for a services-only return (no journalEntryId) but still unwinds + voids', async () => {
    const tx = makePrTx(pr({ journalEntryId: null }));
    await voidPurchaseReturn(tx as never, 'org-a', 'pr-1', { date: DATE });
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(restoreConsumedLayers).toHaveBeenCalled();
    expect((tx.purchaseReturn.updateMany as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });
});
