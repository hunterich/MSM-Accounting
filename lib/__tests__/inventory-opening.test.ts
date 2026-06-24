/**
 * Opening-stock posting: writes a cost layer + a balanced
 * DR Inventory / CR Opening Balance Equity journal entry, exactly once.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { postOpeningStockIfNeeded } from '../inventory-opening';
import { postJournalEntry } from '../journal-posting';
import { assertLinesBalanced } from './journal-balance-helper';

vi.mock('../journal-posting', () => ({
  postJournalEntry: vi.fn().mockResolvedValue({ id: 'JE-1', entryNo: 'JE-000001' }),
}));

vi.mock('../account-defaults', () => ({
  loadOrgAccountDefaults: vi.fn().mockResolvedValue({}),
  resolveAccountDefaultId: vi.fn(
    (_accounts: unknown, _settings: unknown, key: string) =>
      ({ inventoryAsset: 'ACC-INV', openingBalanceEquity: 'ACC-EQ' })[key] ?? '',
  ),
}));

const postJE = vi.mocked(postJournalEntry);

type AnyRecord = Record<string, unknown>;

function makeTx(item: AnyRecord | null, existingOpening: AnyRecord | null = null) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    item: { findUnique: vi.fn().mockResolvedValue(item) },
    inventoryLedgerEntry: {
      findFirst: vi.fn().mockResolvedValue(existingOpening),
      create: vi.fn().mockResolvedValue({}),
    },
    inventoryLot: { create: vi.fn().mockResolvedValue({}) },
    account: { findMany: vi.fn().mockResolvedValue([]) },
  } as AnyRecord;
}

const stockedItem = {
  id: 'item-1',
  sku: 'SKU-1',
  type: 'PRODUCT',
  openingStock: 10,
  costPrice: 100,
  inventoryAccountId: null,
};

beforeEach(() => postJE.mockClear());

describe('postOpeningStockIfNeeded', () => {
  it('posts a balanced DR Inventory / CR Opening Balance Equity entry', async () => {
    const tx = makeTx({ ...stockedItem });
    await postOpeningStockIfNeeded(tx as never, 'org-1', 'item-1', new Date('2026-01-01'));

    expect((tx.inventoryLot as AnyRecord).create).toHaveBeenCalledTimes(1);
    const lines = postJE.mock.calls[0][1].lines;
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'ACC-INV', debit: 1000, credit: 0 }),
      expect.objectContaining({ accountId: 'ACC-EQ', debit: 0, credit: 1000 }),
    ]);
    assertLinesBalanced(lines);
  });

  it('is idempotent — skips when an OPENING entry already exists', async () => {
    const tx = makeTx({ ...stockedItem }, { id: 'existing' });
    await postOpeningStockIfNeeded(tx as never, 'org-1', 'item-1');
    expect((tx.inventoryLot as AnyRecord).create).not.toHaveBeenCalled();
    expect(postJE).not.toHaveBeenCalled();
  });

  it('skips non-stocked item types', async () => {
    const tx = makeTx({ ...stockedItem, type: 'SERVICE' });
    await postOpeningStockIfNeeded(tx as never, 'org-1', 'item-1');
    expect((tx.inventoryLedgerEntry as AnyRecord).findFirst).not.toHaveBeenCalled();
    expect(postJE).not.toHaveBeenCalled();
  });

  it('skips items with no opening stock', async () => {
    const tx = makeTx({ ...stockedItem, openingStock: 0 });
    await postOpeningStockIfNeeded(tx as never, 'org-1', 'item-1');
    expect(postJE).not.toHaveBeenCalled();
  });

  it('writes the cost layer even when cost is zero, but posts no journal entry', async () => {
    const tx = makeTx({ ...stockedItem, costPrice: 0 });
    await postOpeningStockIfNeeded(tx as never, 'org-1', 'item-1');
    expect((tx.inventoryLot as AnyRecord).create).toHaveBeenCalledTimes(1);
    expect(postJE).not.toHaveBeenCalled();
  });

  it('throws when the Opening Balance Equity account cannot be resolved', async () => {
    const { resolveAccountDefaultId } = await import('../account-defaults');
    vi.mocked(resolveAccountDefaultId).mockImplementationOnce(() => 'ACC-INV'); // inventoryAsset
    vi.mocked(resolveAccountDefaultId).mockImplementationOnce(() => ''); // openingBalanceEquity missing
    const tx = makeTx({ ...stockedItem });
    await expect(postOpeningStockIfNeeded(tx as never, 'org-1', 'item-1')).rejects.toThrow(/Opening Balance Equity/);
  });
});
