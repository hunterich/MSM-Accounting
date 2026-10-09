import { describe, expect, it, vi, beforeEach } from 'vitest';
import { postInvoiceSend } from '../invoice-send-posting';

vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('../inventory-costing', () => ({ calculateAndPostCOGS: vi.fn(async () => 0), lockInventoryItems: vi.fn(async () => undefined) }));

import { postJournalEntry } from '../journal-posting';
import { calculateAndPostCOGS } from '../inventory-costing';

const ACCOUNTS = [
  { id: 'acc-ar', code: '121', name: 'Piutang Usaha', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-sales', code: '41', name: 'Penjualan', type: 'Revenue', isActive: true, isPostable: true },
  { id: 'acc-freight', code: '42', name: 'Pendapatan Pengiriman', type: 'Revenue', isActive: true, isPostable: true },
  { id: 'acc-outtax', code: '22', name: 'PPN Keluaran', type: 'Liability', isActive: true, isPostable: true },
];

function makeTx(invoiceOver: any = {}) {
  const invoice = {
    number: 'INV-0001', issueDate: new Date('2026-06-01'),
    subtotal: 100000, discountAmount: 0, totalAmount: 120000, taxAmount: 0,
    taxInclusive: false, taxRate: 0,
    charges: [],
    ...invoiceOver,
  };
  return {
    salesInvoice: { findUnique: vi.fn(async () => invoice), update: vi.fn(async () => invoice) },
    account: { findMany: vi.fn(async () => ACCOUNTS) },
    organization: { findUnique: vi.fn(async () => ({ accountDefaults: null, costingMethod: null })) },
    salesInvoiceLine: { findMany: vi.fn(async () => []) },
    item: { findMany: vi.fn(async () => []) },
  };
}

describe('postInvoiceSend — additional charges', () => {
  beforeEach(() => { (postJournalEntry as any).mockClear(); });

  it('a non-taxable charge credits its own (income) account, not sales revenue', async () => {
    const tx = makeTx({
      totalAmount: 120000, taxAmount: 0,
      charges: [{ accountId: 'acc-freight', amount: 20000, taxRate: 0 }],
    });
    await postInvoiceSend(tx as any, 'org-a', 'inv-1');
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-ar').debit).toBe(120000);
    expect(je.lines.find((l: any) => l.accountId === 'acc-sales').credit).toBe(100000);   // goods revenue only
    expect(je.lines.find((l: any) => l.accountId === 'acc-freight').credit).toBe(20000);   // the delivery charge
    const totDr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totCr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totDr - totCr)).toBeLessThan(0.01);
  });

  it('a charge with no/invalid account stays folded into sales revenue', async () => {
    const tx = makeTx({
      totalAmount: 120000, taxAmount: 0,
      charges: [{ accountId: null, amount: 20000, taxRate: 0 }],
    });
    await postInvoiceSend(tx as any, 'org-a', 'inv-1');
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-sales').credit).toBe(120000);
    expect(je.lines.some((l: any) => l.accountId === 'acc-freight')).toBe(false);
  });

  it('a taxable charge: net credits the income account, output tax already in taxAmount', async () => {
    const tx = makeTx({
      // line 100000 + charge 10000, PPN 11% exclusive on (100000+10000) = 12100
      totalAmount: 122100, taxAmount: 12100, taxInclusive: false, taxRate: 11,
      charges: [{ accountId: 'acc-freight', amount: 10000, taxRate: 11 }],
    });
    await postInvoiceSend(tx as any, 'org-a', 'inv-1');
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-ar').debit).toBe(122100);
    expect(je.lines.find((l: any) => l.accountId === 'acc-sales').credit).toBe(100000);   // goods
    expect(je.lines.find((l: any) => l.accountId === 'acc-freight').credit).toBe(10000);   // charge net
    expect(je.lines.find((l: any) => l.accountId === 'acc-outtax').credit).toBe(12100);    // PPN on goods + charge
    const totDr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totCr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totDr - totCr)).toBeLessThan(0.01);
  });
});

describe('postInvoiceSend — original cost snapshots', () => {
  it('saves the actual consumed COGS on each source line, including zero cost', async () => {
    const tx = makeTx() as any;
    tx.organization.findUnique.mockResolvedValue({ costingMethod: 'FIFO', accountDefaults: {
      inventoryAsset: 'acc-inventory', cogsExpense: 'acc-cogs',
    } });
    tx.account.findMany.mockResolvedValue([...ACCOUNTS,
      { id: 'acc-inventory', code: '131', name: 'Inventory', type: 'Asset', isActive: true, isPostable: true },
      { id: 'acc-cogs', code: '51', name: 'COGS', type: 'Expense', isActive: true, isPostable: true },
    ]);
    tx.salesInvoiceLine.findMany.mockResolvedValue([
      { id: 'line-1', itemId: 'item-1', quantity: 2 },
      { id: 'line-2', itemId: 'item-1', quantity: 1 },
    ]);
    tx.salesInvoiceLine.update = vi.fn();
    tx.item.findMany.mockResolvedValue([{ id: 'item-1' }]);
    vi.mocked(calculateAndPostCOGS).mockResolvedValueOnce(225).mockResolvedValueOnce(0);
    await postInvoiceSend(tx, 'org-a', 'inv-1');
    expect(tx.salesInvoiceLine.update.mock.calls).toEqual([
      [{ where: { id: 'line-1' }, data: { cogsAmount: 225 } }],
      [{ where: { id: 'line-2' }, data: { cogsAmount: 0 } }],
    ]);
  });
});
