import { describe, expect, it, vi, beforeEach } from 'vitest';
import { postBillToLedger } from '../bill-posting';

vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));

import { addCostLayer } from '../inventory-costing';
import { postJournalEntry } from '../journal-posting';

const ACCOUNTS = [
  { id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-ap', code: '21', name: 'Hutang Usaha', type: 'Liability', isActive: true, isPostable: true },
  { id: 'acc-tax', code: '121', name: 'PPN Masukan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-exp', code: '51', name: 'HPP', type: 'Expense', isActive: true, isPostable: true },
];

function makeTx() {
  return {
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO', accountDefaults: null })) },
    account: { findMany: vi.fn(async () => ACCOUNTS), findFirst: vi.fn(), create: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) }, // item-1 is inventory
  };
}

function bill(over: any = {}) {
  return {
    id: 'bill-1', number: 'BILL-0001', issueDate: new Date('2026-06-01'),
    apAccountId: null, taxable: false, taxInclusive: false, taxRate: 0,
    lines: [{ id: 'bl-1', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: 'pol-1' }],
    ...over,
  };
}

describe('postBillToLedger', () => {
  beforeEach(() => {
    (addCostLayer as any).mockClear();
    (postJournalEntry as any).mockClear();
  });

  it('received PO inventory line -> Dr GR/IR, no new cost layer', async () => {
    const tx = makeTx();
    await postBillToLedger(tx as any, 'org-a', bill());
    expect(addCostLayer).not.toHaveBeenCalled();
    const je = (postJournalEntry as any).mock.calls[0][1];
    const grir = je.lines.find((l: any) => l.accountId === 'acc-grir');
    expect(grir.debit).toBe(10000);
    const ap = je.lines.find((l: any) => l.accountId === 'acc-ap');
    expect(ap.credit).toBe(10000);
  });

  it('manual (no PO link) inventory line -> Dr Inventory + cost layer', async () => {
    const tx = makeTx();
    const b = bill({ lines: [{ id: 'bl-1', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null }] });
    await postBillToLedger(tx as any, 'org-a', b);
    expect(addCostLayer).toHaveBeenCalledTimes(1);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-inv').debit).toBe(10000);
  });

  it('VAT-inclusive received line values GR/IR at net and adds input tax', async () => {
    const tx = makeTx();
    const b = bill({ taxable: true, taxInclusive: true, taxRate: 11 });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    const grir = je.lines.find((l: any) => l.accountId === 'acc-grir');
    const tax = je.lines.find((l: any) => l.accountId === 'acc-tax');
    const ap = je.lines.find((l: any) => l.accountId === 'acc-ap');
    expect(grir.debit).toBeCloseTo(9009.01, 1);   // 10000 / 1.11
    expect(tax.debit).toBeCloseTo(990.99, 1);      // 10000 - net
    expect(ap.credit).toBe(10000);                 // gross
    const totDr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totCr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totDr - totCr)).toBeLessThan(0.01);
  });
});
