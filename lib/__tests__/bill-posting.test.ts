import { describe, expect, it, vi, beforeEach } from 'vitest';
import { postBillToLedger } from '../bill-posting';

vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));
vi.mock('../withholding', () => ({ ensurePphPayableAccount: vi.fn(async () => 'acc-pph') }));

import { addCostLayer } from '../inventory-costing';
import { postJournalEntry } from '../journal-posting';

const ACCOUNTS = [
  { id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-ap', code: '21', name: 'Hutang Usaha', type: 'Liability', isActive: true, isPostable: true },
  { id: 'acc-tax', code: '121', name: 'PPN Masukan', type: 'Asset', isActive: true, isPostable: true },
  { id: 'acc-exp', code: '51', name: 'HPP', type: 'Expense', isActive: true, isPostable: true },
  { id: 'acc-rent', code: '52', name: 'Beban Sewa', type: 'Expense', isActive: true, isPostable: true },
  { id: 'acc-prepaid', code: '141', name: 'Sewa Dibayar Dimuka', type: 'Asset', isActive: true, isPostable: true },
];

function makeTx(receiptLotCount = 0) {
  return {
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO', accountDefaults: null })) },
    account: { findMany: vi.fn(async () => ACCOUNTS), findFirst: vi.fn(), create: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) }, // item-1 is inventory
    inventoryLot: { count: vi.fn(async () => receiptLotCount) },
    bill: { update: vi.fn(async () => ({})) },
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

  it('inventory line whose PO link was stripped on edit still clears GR/IR (no double-count) when a receipt layer already exists', async () => {
    const tx = makeTx(1); // a goods-receipt cost layer already exists for this bill
    const b = bill({ lines: [{ id: 'bl-1', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null }] });
    await postBillToLedger(tx as any, 'org-a', b);
    // Must NOT re-book inventory or add a second cost layer.
    expect(addCostLayer).not.toHaveBeenCalled();
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-grir').debit).toBe(10000);
    expect(je.lines.some((l: any) => l.accountId === 'acc-inv')).toBe(false);
  });

  it('records the posting journal-entry id on the bill (so it can be voided)', async () => {
    const tx = makeTx();
    await postBillToLedger(tx as any, 'org-a', bill());
    expect(tx.bill.update).toHaveBeenCalledTimes(1);
    const arg = (tx.bill.update as any).mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'bill-1' });
    expect(arg.data).toMatchObject({ journalEntryId: 'je-1' });
  });

  it('manual (no PO link) inventory line -> Dr Inventory + cost layer', async () => {
    const tx = makeTx();
    const b = bill({ lines: [{ id: 'bl-1', itemId: 'item-1', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null }] });
    await postBillToLedger(tx as any, 'org-a', b);
    expect(addCostLayer).toHaveBeenCalledTimes(1);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-inv').debit).toBe(10000);
  });

  it('expense lines post to their own per-line accountId, not one COGS bucket', async () => {
    const tx = makeTx();
    const b = bill({ lines: [
      { id: 'e1', itemId: null, accountId: 'acc-rent', quantity: 1, price: 5000, lineTotal: 5000, purchaseOrderLineId: null },
      { id: 'e2', itemId: null, accountId: 'acc-exp', quantity: 1, price: 3000, lineTotal: 3000, purchaseOrderLineId: null },
    ] });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-rent').debit).toBe(5000);
    expect(je.lines.find((l: any) => l.accountId === 'acc-exp').debit).toBe(3000);
    expect(je.lines.find((l: any) => l.accountId === 'acc-ap').credit).toBe(8000);
  });

  it('honors a per-line asset account (capex / prepaid), not COGS', async () => {
    const tx = makeTx();
    const b = bill({ lines: [
      { id: 'e1', itemId: null, accountId: 'acc-prepaid', quantity: 1, price: 12000, lineTotal: 12000, purchaseOrderLineId: null },
    ] });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-prepaid').debit).toBe(12000);
    expect(je.lines.some((l: any) => l.accountId === 'acc-exp')).toBe(false);
  });

  it('merges multiple lines coded to the same account into one debit', async () => {
    const tx = makeTx();
    const b = bill({ lines: [
      { id: 'e1', itemId: null, accountId: 'acc-rent', quantity: 1, price: 5000, lineTotal: 5000, purchaseOrderLineId: null },
      { id: 'e2', itemId: null, accountId: 'acc-rent', quantity: 1, price: 2000, lineTotal: 2000, purchaseOrderLineId: null },
    ] });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    const rentLines = je.lines.filter((l: any) => l.accountId === 'acc-rent');
    expect(rentLines).toHaveLength(1);
    expect(rentLines[0].debit).toBe(7000);
  });

  it('expense line with no accountId falls back to the cogsExpense default', async () => {
    const tx = makeTx();
    const b = bill({ lines: [
      { id: 'e1', itemId: null, accountId: null, quantity: 1, price: 5000, lineTotal: 5000, purchaseOrderLineId: null },
    ] });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-exp').debit).toBe(5000);
  });

  it('expense line coded to an unknown account falls back to the default (safety)', async () => {
    const tx = makeTx();
    const b = bill({ lines: [
      { id: 'e1', itemId: null, accountId: 'acc-bogus', quantity: 1, price: 5000, lineTotal: 5000, purchaseOrderLineId: null },
    ] });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-exp').debit).toBe(5000);
  });

  it('PPh withholding -> Cr PPh payable for the withheld amount, AP reduced to the net payable', async () => {
    const tx = makeTx();
    const b = bill({
      taxable: false,
      withholdingRate: 2, // PPh 23 @ 2% on services
      lines: [{ id: 'e1', itemId: null, accountId: 'acc-rent', quantity: 1, price: 100000, lineTotal: 100000, purchaseOrderLineId: null }],
    });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    // Expense debited at the full (pre-withholding) value.
    expect(je.lines.find((l: any) => l.accountId === 'acc-rent').debit).toBe(100000);
    // The withheld 2% becomes a liability owed to the tax office.
    expect(je.lines.find((l: any) => l.accountId === 'acc-pph').credit).toBe(2000);
    // The vendor is only owed the net: 100000 - 2000.
    expect(je.lines.find((l: any) => l.accountId === 'acc-ap').credit).toBe(98000);
    const totDr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totCr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totDr - totCr)).toBeLessThan(0.01);
  });

  it('withholding computes off the pre-tax net even when PPN applies', async () => {
    const tx = makeTx();
    const b = bill({
      taxable: true, taxInclusive: false, taxRate: 11,
      withholdingRate: 2,
      lines: [{ id: 'e1', itemId: null, accountId: 'acc-rent', quantity: 1, price: 100000, lineTotal: 100000, purchaseOrderLineId: null }],
    });
    await postBillToLedger(tx as any, 'org-a', b);
    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-rent').debit).toBe(100000);   // expense net
    expect(je.lines.find((l: any) => l.accountId === 'acc-tax').debit).toBe(11000);      // PPN 11% (exclusive)
    expect(je.lines.find((l: any) => l.accountId === 'acc-pph').credit).toBe(2000);       // PPh 2% on net, not on net+PPN
    expect(je.lines.find((l: any) => l.accountId === 'acc-ap').credit).toBe(109000);      // 100000 + 11000 - 2000
    const totDr = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totCr = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(Math.abs(totDr - totCr)).toBeLessThan(0.01);
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
