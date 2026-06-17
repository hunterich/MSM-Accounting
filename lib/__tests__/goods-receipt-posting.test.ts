import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));

import { addCostLayer } from '../inventory-costing';
import { postJournalEntry } from '../journal-posting';
import { postGoodsReceiptToLedger } from '../goods-receipt-posting';

const ACCOUNTS = [
  { id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-grir', code: '2150', name: 'GR/IR', type: 'Liability', isActive: true, isPostable: true },
];

function makeTx(accounts: any[] = ACCOUNTS) {
  return {
    organization: { findUnique: vi.fn(async () => ({ accountDefaults: null })) },
    account: { findMany: vi.fn(async () => accounts), findFirst: vi.fn(), create: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) }, // item-1 is inventory
  };
}

const args = (over: any = {}) => ({
  billId: 'bill-1', poNumber: 'PO-0001', date: new Date('2026-06-01'),
  taxInclusive: false, taxRate: 0,
  lines: [{ itemId: 'item-1', quantity: 10, lineTotal: 10000 }],
  ...over,
});

describe('postGoodsReceiptToLedger', () => {
  beforeEach(() => {
    (addCostLayer as any).mockClear();
    (postJournalEntry as any).mockClear();
  });

  it('posts Dr Inventory / Cr GR/IR and adds a cost layer', async () => {
    const tx = makeTx();
    await postGoodsReceiptToLedger(tx as any, 'org-a', args());
    expect(addCostLayer).toHaveBeenCalledTimes(1);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-inv').debit).toBe(10000);
    expect(je.lines.find((l: any) => l.accountId === 'acc-grir').credit).toBe(10000);
  });

  it('values inventory at net when VAT-inclusive', async () => {
    const tx = makeTx();
    await postGoodsReceiptToLedger(tx as any, 'org-a', args({ taxInclusive: true, taxRate: 11 }));
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-inv').debit).toBeCloseTo(9009.01, 1);
  });

  it('fails loud and writes NO cost layer when the inventory account is unconfigured', async () => {
    const tx = makeTx([ACCOUNTS[1]]); // GR/IR present, no asset/inventory account
    await expect(postGoodsReceiptToLedger(tx as any, 'org-a', args())).rejects.toThrow(/no Inventory asset account/i);
    expect(addCostLayer).not.toHaveBeenCalled();
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('does nothing when there are no stocked lines', async () => {
    const tx = makeTx();
    await postGoodsReceiptToLedger(tx as any, 'org-a', args({ lines: [{ itemId: null, quantity: 1, lineTotal: 500 }] }));
    expect(addCostLayer).not.toHaveBeenCalled();
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
});
