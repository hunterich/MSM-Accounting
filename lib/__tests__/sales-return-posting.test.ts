import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postSalesReturnOnApproval } from '../sales-return-posting';
import { addCostLayer } from '../inventory-costing';
import { postJournalEntry } from '../journal-posting';

vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn() }));
vi.mock('../inventory-costing', () => ({ addCostLayer: vi.fn() }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('../account-defaults', () => ({
  loadOrgAccountDefaults: vi.fn(),
  resolveAccountDefaultId: vi.fn((_accounts, _settings, key) => key),
}));

function fixture({ qty = 1, received = true, cost = 100, postedAt = null as Date | null, priorQty = 0, priorCost = 0.33 } = {}) {
  const source = { id: 'line-1', invoiceId: 'inv-1', itemId: 'item-1', description: 'Product', quantity: 3, cogsAmount: cost };
  const line = { id: 'return-line', sourceInvoiceLineId: source.id, itemId: source.itemId, itemName: 'Product', qtyReturn: qty, goodsReceived: received };
  const ret = { id: 'sr-1', number: 'SR-1', organizationId: 'org-1', invoiceId: 'inv-1', customerId: 'customer-1', status: 'APPROVED', journalEntryId: null, postedAt, returnDate: new Date('2026-09-01'), warehouseId: null, lines: [line] };
  const prior = priorQty ? [{ ...line, qtyReturn: priorQty, inventoryCost: priorCost }] : [];
  const tx = {
    $executeRaw: vi.fn(),
    salesReturn: { findUnique: vi.fn(async () => ret), update: vi.fn() },
    salesInvoice: { findFirst: vi.fn(async () => ({ id: 'inv-1', customerId: 'customer-1', status: 'SENT', lines: [source] })) },
    salesReturnLine: { findMany: vi.fn(async () => prior), update: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) },
    account: { findMany: vi.fn(async () => []) },
  };
  return { tx, ret };
}

beforeEach(() => vi.clearAllMocks());
describe('sales return posting', () => {
  it('restocks and reverses original COGS rather than current inventory cost', async () => {
    const { tx } = fixture();
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).toHaveBeenCalledWith(tx, 'org-1', 'item-1', null, 1, 33.33, 'SALES_RETURN', 'sr-1', expect.any(Date));
    expect(postJournalEntry).toHaveBeenCalledWith(tx, expect.objectContaining({ lines: [
      expect.objectContaining({ accountId: 'inventoryAsset', debit: 33.33, credit: 0 }),
      expect.objectContaining({ accountId: 'cogsExpense', debit: 0, credit: 33.33 }),
    ] }));
  });
  it('kept goods leave stock and COGS unchanged and still receive a posting token', async () => {
    const { tx } = fixture({ received: false });
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).not.toHaveBeenCalled();
    expect(postJournalEntry).not.toHaveBeenCalled();
    expect(tx.salesReturn.update).toHaveBeenCalledWith({ where: { id: 'sr-1' }, data: { postedAt: expect.any(Date) } });
  });
  it('posts zero-cost stock quantities without a journal entry', async () => {
    const { tx } = fixture({ cost: 0 });
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).toHaveBeenCalledWith(tx, 'org-1', 'item-1', null, 1, 0, 'SALES_RETURN', 'sr-1', expect.any(Date));
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
  it('uses cumulative rounding for repeated partial returns', async () => {
    const { tx } = fixture({ cost: 1, priorQty: 1 });
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).toHaveBeenCalledWith(tx, 'org-1', 'item-1', null, 1, 0.34, 'SALES_RETURN', 'sr-1', expect.any(Date));
  });
  it('a second posting of a no-journal return has no side effects', async () => {
    const { tx } = fixture({ postedAt: new Date() });
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).not.toHaveBeenCalled();
    expect(tx.salesReturn.update).not.toHaveBeenCalled();
  });
  it('a replacement after void respects the cost of surviving partial returns', async () => {
    const { tx } = fixture({ cost: 1, priorQty: 1, priorCost: 0.34 });
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).toHaveBeenCalledWith(tx, 'org-1', 'item-1', null, 1, 0.33, 'SALES_RETURN', 'sr-1', expect.any(Date));
  });
  it('handles mixed received and kept lines in the same return', async () => {
    const { tx, ret } = fixture({ received: false });
    ret.lines.push({ ...ret.lines[0], id: 'received-line', goodsReceived: true });
    await postSalesReturnOnApproval(tx as any, 'sr-1');
    expect(addCostLayer).toHaveBeenCalledTimes(1);
    expect(addCostLayer).toHaveBeenCalledWith(tx, 'org-1', 'item-1', null, 1, 33.33, 'SALES_RETURN', 'sr-1', expect.any(Date));
  });
});
