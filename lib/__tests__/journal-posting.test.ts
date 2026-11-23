/**
 * Tests for `postJournalEntry` — covers the balance invariant, the rejection
 * paths, and verifies that the lines payload Prisma receives is balanced
 * using the shared `assertLinesBalanced` helper. We mock the transaction
 * client at the `journalEntry.create` boundary so we can capture whatever
 * shape gets persisted.
 */
import { describe, expect, it, vi } from 'vitest';
import { allocateJournalEntryNumber, postJournalEntry } from '../journal-posting';
import { assertLinesBalanced } from './journal-balance-helper';

type MockTx = {
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  journalEntry: { create: ReturnType<typeof vi.fn> };
};

function makeTx(): MockTx {
  return {
    // nextEntryNo takes a per-org advisory lock before reading the max sequence.
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ max_seq: 7 }]),
    journalEntry: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { entryNo: string } }) => ({
        id: 'je-mock',
        entryNo: data.entryNo,
      })),
    },
  };
}

const baseArgs = {
  organizationId: 'org-1',
  date: new Date('2026-05-01'),
  memo: 'Test posting',
};

describe('postJournalEntry', () => {
  it('creates a posted entry when debit/credit balance and lines pass the helper check', async () => {
    const tx = makeTx();
    const result = await postJournalEntry(tx as never, {
      ...baseArgs,
      lines: [
        { accountId: 'cash', description: 'cash in', debit: 1000, credit: 0 },
        { accountId: 'rev', description: 'revenue', debit: 0, credit: 1000 },
      ],
    });

    expect(result.entryNo).toBe('JE-000008');
    expect(tx.journalEntry.create).toHaveBeenCalledTimes(1);

    const captured = tx.journalEntry.create.mock.calls[0][0].data;
    expect(captured.status).toBe('POSTED');
    expect(captured.lines.create).toHaveLength(2);

    expect(() => assertLinesBalanced(captured.lines.create)).not.toThrow();
  });

  it('rejects unbalanced lines before any DB write', async () => {
    const tx = makeTx();
    await expect(
      postJournalEntry(tx as never, {
        ...baseArgs,
        lines: [
          { accountId: 'cash', description: 'cash in', debit: 1000, credit: 0 },
          { accountId: 'rev', description: 'revenue', debit: 0, credit: 999 },
        ],
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rejects empty line lists', async () => {
    const tx = makeTx();
    await expect(
      postJournalEntry(tx as never, { ...baseArgs, lines: [] }),
    ).rejects.toThrow(/empty/);
  });

  it('absorbs sub-cent float drift and still balances on persist', async () => {
    const tx = makeTx();
    // 0.1 + 0.2 in JS = 0.30000000000000004; the helper must round both
    // sides to 2dp and persist a balanced entry.
    await postJournalEntry(tx as never, {
      ...baseArgs,
      lines: [
        { accountId: 'cash', description: 'a', debit: 0.1, credit: 0 },
        { accountId: 'cash', description: 'b', debit: 0.2, credit: 0 },
        { accountId: 'rev', description: 'c', debit: 0, credit: 0.3 },
      ],
    });
    const captured = tx.journalEntry.create.mock.calls[0][0].data;
    expect(captured.totalDebit.toFixed(2)).toBe('0.30');
    expect(captured.totalCredit.toFixed(2)).toBe('0.30');
    expect(() => assertLinesBalanced(captured.lines.create)).not.toThrow();
  });

  it('rejects two half-cent debits whose saved amounts exceed the credit', async () => {
    const tx = makeTx();
    await expect(postJournalEntry(tx as never, {
      ...baseArgs,
      lines: [
        { accountId: 'cash', description: 'First debit', debit: '0.005', credit: 0 },
        { accountId: 'cash', description: 'Second debit', debit: '0.005', credit: 0 },
        { accountId: 'rev', description: 'Offset', debit: 0, credit: '0.01' },
      ],
    })).rejects.toThrow(/unbalanced.*debit=0.02 credit=0.01/);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('dates a clock-time posting on its Jakarta business day', async () => {
    const tx = makeTx();
    // A POS sale at 01:30 WIB on 1 May is 18:30 UTC on 30 April.
    await postJournalEntry(tx as never, {
      ...baseArgs,
      date: new Date('2026-04-30T18:30:00.000Z'),
      lines: [
        { accountId: 'cash', description: 'cash in', debit: 50, credit: 0 },
        { accountId: 'rev', description: 'revenue', debit: 0, credit: 50 },
      ],
    });
    expect(tx.journalEntry.create.mock.calls[0][0].data.date)
      .toEqual(new Date('2026-05-01T00:00:00.000Z'));
  });
});

describe('allocateJournalEntryNumber', () => {
  it('reads the higher of the books and the issued high-water mark, then records the new mark', async () => {
    const tx = makeTx();
    // The query returns GREATEST(max on the books, JournalEntrySequence.lastSeq).
    tx.$queryRaw.mockResolvedValue([{ max_seq: 12 }]);
    expect(await allocateJournalEntryNumber(tx as never, 'org-1')).toBe('JE-000013');

    const query = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(query).toContain('GREATEST');
    expect(query).toContain('"JournalEntrySequence"');

    // Advisory lock first, then the high-water mark is written as 13.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const upsert = tx.$executeRaw.mock.calls[1];
    expect((upsert[0] as TemplateStringsArray).join('?')).toContain('INSERT INTO "JournalEntrySequence"');
    expect(upsert.slice(1)).toEqual(['org-1', 13]);
  });
});
