/**
 * unreceiveGoodsReceipt reverses a draft goods-receipt bill: removes the cost
 * layers, posts the GL contra (Dr GR/IR · Cr Inventory), rolls back the PO's
 * receivedQty + status, and soft-deletes the receipt bill.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../inventory-costing', () => ({ reversePurchaseLayers: vi.fn(async () => 11000) }));
vi.mock('../journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-1' })) }));
vi.mock('../grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../account-defaults', async (orig) => ({ ...(await orig<any>()), loadOrgAccountDefaults: vi.fn(async () => ({})) }));

import { reversePurchaseLayers } from '../inventory-costing';
import { postJournalEntry } from '../journal-posting';
import { assertPeriodOpen } from '../period-guard';
import { unreceiveGoodsReceipt } from '../unreceive-goods';

const DATE = new Date('2026-06-14');
const ACCOUNTS = [{ id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true }];

function makeTx(bill: any, poLinesAfter: any[] = [{ quantity: 10, receivedQty: 0 }], claimCount = 1) {
  return {
    bill: {
      findFirst: vi.fn(async () => bill),
      updateMany: vi.fn(async () => ({ count: claimCount })),
    },
    purchaseOrderLine: { update: vi.fn(async () => ({})), findMany: vi.fn(async () => poLinesAfter) },
    purchaseOrder: { update: vi.fn(async () => ({})) },
    account: { findMany: vi.fn(async () => ACCOUNTS) },
  };
}

const receiptBill = (over: any = {}) => ({
  id: 'bill-1', number: 'BILL-0001', status: 'DRAFT', poId: 'po-1', deletedAt: null,
  lines: [
    { id: 'bl-1', itemId: 'item-1', quantity: 10, purchaseOrderLineId: 'pol-1' },
    { id: 'bl-2', itemId: 'item-2', quantity: 4, purchaseOrderLineId: 'pol-2' },
  ],
  ...over,
});

describe('unreceiveGoodsReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses inventory, posts Dr GR/IR · Cr Inventory, rolls back the PO, and soft-deletes the bill', async () => {
    const tx = makeTx(receiptBill());
    await unreceiveGoodsReceipt(tx as never, 'org-a', 'bill-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    // Un-receive is claimed atomically (soft-delete token) BEFORE any side effect.
    const claim = (tx.bill.updateMany as any).mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'bill-1', status: 'DRAFT', deletedAt: null });
    expect(claim.data).toMatchObject({ deletedAt: DATE });
    expect(reversePurchaseLayers).toHaveBeenCalledWith(tx, 'org-a', 'bill-1', DATE);

    const je = (postJournalEntry as any).mock.calls[0][1];
    expect(je.lines.find((l: any) => l.accountId === 'acc-grir').debit).toBe(11000);
    expect(je.lines.find((l: any) => l.accountId === 'acc-inv').credit).toBe(11000);

    // receivedQty decremented per receipt line
    expect(tx.purchaseOrderLine.update).toHaveBeenCalledWith({ where: { id: 'pol-1' }, data: { receivedQty: { decrement: 10 } } });
    expect(tx.purchaseOrderLine.update).toHaveBeenCalledWith({ where: { id: 'pol-2' }, data: { receivedQty: { decrement: 4 } } });

    // nothing left received -> PO back to APPROVED
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'APPROVED' } });

    // receipt bill soft-deleted exactly once, by the atomic claim above.
    expect((tx.bill.updateMany as any).mock.calls.length).toBe(1);
  });

  it('rejects 409 if a concurrent un-receive already claimed it (claim count 0)', async () => {
    const tx = makeTx(receiptBill(), [{ quantity: 10, receivedQty: 0 }], 0);
    await expect(unreceiveGoodsReceipt(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/already un-received/i);
    // Lost the claim race → no lot reversal, no PO decrement.
    expect(reversePurchaseLayers).not.toHaveBeenCalled();
    expect(tx.purchaseOrderLine.update).not.toHaveBeenCalled();
  });

  it('sets the PO back to PARTIAL_RECEIVED when other receipts remain', async () => {
    const tx = makeTx(receiptBill(), [{ quantity: 10, receivedQty: 3 }]);
    await unreceiveGoodsReceipt(tx as never, 'org-a', 'bill-1', { date: DATE });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'PARTIAL_RECEIVED' } });
  });

  it('refuses a bill that is not a goods receipt (no PO link)', async () => {
    const tx = makeTx(receiptBill({ poId: null }));
    await expect(unreceiveGoodsReceipt(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/goods receipt/i);
    expect(reversePurchaseLayers).not.toHaveBeenCalled();
  });

  it('refuses a finalized (non-draft) receipt — void the bill first', async () => {
    const tx = makeTx(receiptBill({ status: 'OPEN' }));
    await expect(unreceiveGoodsReceipt(tx as never, 'org-a', 'bill-1', { date: DATE })).rejects.toThrow(/draft|void/i);
    expect(reversePurchaseLayers).not.toHaveBeenCalled();
    expect(tx.bill.updateMany).not.toHaveBeenCalled();
  });

  it('throws 404 when the bill does not exist', async () => {
    const tx = makeTx(null);
    await expect(unreceiveGoodsReceipt(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
  });
});
