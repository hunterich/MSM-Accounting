/**
 * reverseJournalEntry loads a posted entry and posts a fresh balanced entry
 * with each line's debit/credit swapped, sourced REVERSAL.
 */
import { describe, expect, it, vi } from 'vitest';
import { reverseJournalEntry } from '../reverse-journal-entry';

function makeTx(original: unknown) {
  return {
    journalEntry: {
      findUnique: vi.fn().mockResolvedValue(original),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'je-rev', entryNo: data.entryNo })),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ max_seq: 41 }]),
  };
}

const ORIGINAL = {
  id: 'je-1',
  organizationId: 'org-1',
  lines: [
    { accountId: 'acc-grir', description: 'GR/IR clearing - BILL-0001', debit: 10000, credit: 0 },
    { accountId: 'acc-ap', description: 'AP - BILL-0001', debit: 0, credit: 10000 },
  ],
};

describe('reverseJournalEntry', () => {
  it('swaps debit and credit on every line and posts a balanced REVERSAL entry', async () => {
    const tx = makeTx(ORIGINAL);
    await reverseJournalEntry(tx as never, 'je-1', { date: new Date('2026-06-14'), memo: 'Void bill: BILL-0001' });

    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.source).toBe('REVERSAL');
    expect(data.memo).toBe('Void bill: BILL-0001');
    const grir = data.lines.create.find((l: any) => l.accountId === 'acc-grir');
    const ap = data.lines.create.find((l: any) => l.accountId === 'acc-ap');
    expect(grir.debit).toBe(0);
    expect(grir.credit).toBe(10000);
    expect(ap.debit).toBe(10000);
    expect(ap.credit).toBe(0);
    expect(data.totalDebit).toBe(10000);
    expect(data.totalCredit).toBe(10000);
  });

  it('throws when the original entry does not exist', async () => {
    const tx = makeTx(null);
    await expect(
      reverseJournalEntry(tx as never, 'missing', { date: new Date('2026-06-14'), memo: 'x' }),
    ).rejects.toThrow(/not found/i);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});
