/**
 * voidCreditNote / voidDebitNote reverse a posted note's journal entry and mark
 * it VOID. Unposted (no journalEntryId) and already-voided notes are refused.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-000099' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { voidCreditNote, voidDebitNote } from '../note-void';

const DATE = new Date('2026-06-20');

function makeCnTx(note: any) {
  return { creditNote: { findFirst: vi.fn(async () => note), update: vi.fn(async () => ({})) } };
}
function makeDnTx(note: any) {
  return { debitNote: { findFirst: vi.fn(async () => note), update: vi.fn(async () => ({})) } };
}

const cnApplied = (over: any = {}) => ({ id: 'cn-1', number: 'CN-0001', status: 'APPLIED', journalEntryId: 'je-1', ...over });
const dnApplied = (over: any = {}) => ({ id: 'dn-1', number: 'DN-0001', status: 'APPLIED', journalEntryId: 'je-2', ...over });

describe('voidCreditNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE and marks VOID', async () => {
    const tx = makeCnTx(cnApplied());
    await voidCreditNote(tx as never, 'org-a', 'cn-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect((tx.creditNote.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('throws 404 when the note does not exist', async () => {
    const tx = makeCnTx(null);
    await expect(voidCreditNote(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an already-voided note', async () => {
    const tx = makeCnTx(cnApplied({ status: 'VOID' }));
    await expect(voidCreditNote(tx as never, 'org-a', 'cn-1', { date: DATE })).rejects.toThrow(/already void/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an unposted (draft) note — delete it instead', async () => {
    const tx = makeCnTx(cnApplied({ journalEntryId: null, status: 'DRAFT' }));
    await expect(voidCreditNote(tx as never, 'org-a', 'cn-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(tx.creditNote.update).not.toHaveBeenCalled();
  });
});

describe('voidDebitNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE and marks VOID', async () => {
    const tx = makeDnTx(dnApplied());
    await voidDebitNote(tx as never, 'org-a', 'dn-1', { date: DATE });

    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-2', expect.objectContaining({ date: DATE }));
    expect((tx.debitNote.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });
});
