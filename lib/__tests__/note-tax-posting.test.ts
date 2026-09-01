/**
 * Tax-split coverage for credit/debit note GL posting.
 *
 * `taxAmount` carves the PPN portion out of the flat note amount:
 *   CreditNote: DR arReturn (net) / DR arTax (tax) / CR arControl (gross)
 *   DebitNote:  DR apControl (gross) / CR apReturn (net) / CR apTax (tax)
 * Zero tax (or applyTax=false) must reproduce the original two-line entry.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { postCreditNoteOnApply } from '../credit-note-posting';
import { postDebitNoteOnApply } from '../debit-note-posting';
import { postJournalEntry } from '../journal-posting';
import { assertLinesBalanced } from './journal-balance-helper';

vi.mock('../journal-posting', () => ({
  postJournalEntry: vi.fn().mockResolvedValue({ id: 'JE-1' }),
}));

vi.mock('../account-defaults', () => ({
  loadOrgAccountDefaults: vi.fn().mockResolvedValue({}),
  resolveAccountDefaultId: vi.fn(
    (_accounts: unknown, _settings: unknown, key: string) =>
      ({
        arReturn: 'ACC-RETURN',
        arControl: 'ACC-AR',
        arTax: 'ACC-OUTPUT-TAX',
        apControl: 'ACC-AP',
        apReturn: 'ACC-PRETURN',
        apTax: 'ACC-INPUT-TAX',
      })[key] ?? null,
  ),
}));

const postJE = vi.mocked(postJournalEntry);

type AnyRecord = Record<string, unknown>;

function makeTx(note: AnyRecord, kind: 'creditNote' | 'debitNote') {
  return {
    [kind]: {
      findUnique: vi.fn().mockResolvedValue(note),
      update: vi.fn().mockResolvedValue({}),
    },
    account: { findMany: vi.fn().mockResolvedValue([]) },
    // assertPeriodOpen() FOR SHARE-locks the posting period via a raw query;
    // an empty result = no period defined = open.
    $queryRaw: vi.fn().mockResolvedValue([]),
    // assertPeriodOpen also reads the org's transaction-date window; null is
    // "never configured", so it restricts nothing.
    organization: { findUnique: vi.fn().mockResolvedValue({ transactionDatePolicy: null }) },
  } as AnyRecord;
}

const baseCN = {
  id: 'CN-1',
  number: 'CRN-00001',
  organizationId: 'org-1',
  date: new Date('2026-06-01'),
  amount: 111000,
  taxAmount: 11000,
  applyTax: true,
  returnAccountId: null,
  arAccountId: null,
  taxAccountId: null,
  journalEntryId: null,
};

const baseDN = {
  id: 'DN-1',
  number: 'DBN-00001',
  organizationId: 'org-1',
  date: new Date('2026-06-01'),
  amount: 222000,
  taxAmount: 22000,
  applyTax: true,
  apAccountId: null,
  returnAccountId: null,
  taxAccountId: null,
  journalEntryId: null,
};

beforeEach(() => {
  postJE.mockClear();
});

describe('postCreditNoteOnApply tax split', () => {
  it('books net to sales-return, tax to output-tax, gross to AR', async () => {
    const tx = makeTx({ ...baseCN }, 'creditNote');
    await postCreditNoteOnApply(tx as never, 'CN-1');

    const lines = postJE.mock.calls[0][1].lines;
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'ACC-RETURN', debit: 100000, credit: 0 }),
      expect.objectContaining({ accountId: 'ACC-OUTPUT-TAX', debit: 11000, credit: 0 }),
      expect.objectContaining({ accountId: 'ACC-AR', debit: 0, credit: 111000 }),
    ]);
    assertLinesBalanced(lines);
  });

  it('keeps the original two-line entry when taxAmount is 0', async () => {
    const tx = makeTx({ ...baseCN, taxAmount: 0 }, 'creditNote');
    await postCreditNoteOnApply(tx as never, 'CN-1');

    const lines = postJE.mock.calls[0][1].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(expect.objectContaining({ accountId: 'ACC-RETURN', debit: 111000 }));
    expect(lines[1]).toEqual(expect.objectContaining({ accountId: 'ACC-AR', credit: 111000 }));
  });

  it('ignores taxAmount when applyTax is false', async () => {
    const tx = makeTx({ ...baseCN, applyTax: false }, 'creditNote');
    await postCreditNoteOnApply(tx as never, 'CN-1');

    const lines = postJE.mock.calls[0][1].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(expect.objectContaining({ debit: 111000 }));
  });

  it('rejects taxAmount >= gross amount', async () => {
    const tx = makeTx({ ...baseCN, taxAmount: 111000 }, 'creditNote');
    await expect(postCreditNoteOnApply(tx as never, 'CN-1')).rejects.toThrow(/taxAmount/);
    expect(postJE).not.toHaveBeenCalled();
  });

  it('prefers the note-level taxAccountId over the org default', async () => {
    const tx = makeTx({ ...baseCN, taxAccountId: 'ACC-CUSTOM-TAX' }, 'creditNote');
    await postCreditNoteOnApply(tx as never, 'CN-1');

    const lines = postJE.mock.calls[0][1].lines;
    expect(lines[1]).toEqual(expect.objectContaining({ accountId: 'ACC-CUSTOM-TAX', debit: 11000 }));
  });
});

describe('postDebitNoteOnApply tax split', () => {
  it('books gross to AP, net to purchase-return, tax to input-tax', async () => {
    const tx = makeTx({ ...baseDN }, 'debitNote');
    await postDebitNoteOnApply(tx as never, 'DN-1');

    const lines = postJE.mock.calls[0][1].lines;
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'ACC-AP', debit: 222000, credit: 0 }),
      expect.objectContaining({ accountId: 'ACC-PRETURN', debit: 0, credit: 200000 }),
      expect.objectContaining({ accountId: 'ACC-INPUT-TAX', debit: 0, credit: 22000 }),
    ]);
    assertLinesBalanced(lines);
  });

  it('keeps the original two-line entry when taxAmount is 0', async () => {
    const tx = makeTx({ ...baseDN, taxAmount: 0 }, 'debitNote');
    await postDebitNoteOnApply(tx as never, 'DN-1');

    const lines = postJE.mock.calls[0][1].lines;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual(expect.objectContaining({ accountId: 'ACC-PRETURN', credit: 222000 }));
  });

  it('rejects negative taxAmount', async () => {
    const tx = makeTx({ ...baseDN, taxAmount: -1 }, 'debitNote');
    await expect(postDebitNoteOnApply(tx as never, 'DN-1')).rejects.toThrow(/taxAmount/);
  });
});
