import { describe, expect, it, vi } from 'vitest';

vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));

import { postJournalEntry } from '../journal-posting';
import { postBillToLedger } from '../bill-posting';

const ACCOUNTS = [
  { id: 'acc-inv', code: '131', name: 'Inv', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-ap', code: '21', name: 'AP', type: 'Liability', isActive: true, isPostable: true },
  { id: 'acc-tax', code: '121', name: 'PPN-In', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-exp', code: '51', name: 'HPP', type: 'Expense', isActive: true, isPostable: true },
];
const tx = () => ({
  organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO' })) },
  account: { findMany: vi.fn(async () => ACCOUNTS), findFirst: vi.fn(), create: vi.fn() },
  item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) },
  inventoryLot: { count: vi.fn(async () => 0) },
});
const billFor = (flags: any) => ({
  id: 'b', number: 'BILL-0001', issueDate: new Date('2026-06-01'), apAccountId: null, ...flags,
  lines: [{ id: 'l', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: 'pol-1' }],
});

describe('GR/IR roundtrip — each VAT case the bill GR/IR debit equals the receipt net credit (10000/1.11 etc.)', () => {
  it.each([
    ['non-PKP', { taxable: false, taxInclusive: false, taxRate: 0 }, 10000],
    ['exclusive', { taxable: true, taxInclusive: false, taxRate: 11 }, 10000],
    ['inclusive', { taxable: true, taxInclusive: true, taxRate: 11 }, 9009.01],
  ])('%s', async (_name, flags, expectedNet) => {
    vi.clearAllMocks();
    await postBillToLedger(tx() as any, 'org-a', billFor(flags));
    const je = (postJournalEntry as any).mock.calls[0][1];
    const grir = je.lines.find((l: any) => l.accountId === 'acc-grir');
    expect(grir.debit).toBeCloseTo(expectedNet, 1);
    const dr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const cr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.01);
  });
});
