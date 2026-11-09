import { afterAll, describe, expect, it } from 'vitest';
import { postGoodsReceiptToLedger } from '@/lib/goods-receipt-posting';
import { unreceiveGoodsReceipt } from '@/lib/unreceive-goods';
import { accountBalance, createTestOrg, createVendor, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');

async function fixture(custom: boolean) {
  const org = await createTestOrg();
  const vendorId = await createVendor(org.orgId);
  const asset = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item inventory', type: 'ASSET', normalSide: 'DEBIT' } });
  const a = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'RECEIPT-A', name: 'A', inventoryAccountId: custom ? asset.id : null } });
  const b = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'RECEIPT-B', name: 'B' } });
  const po = await prisma.purchaseOrder.create({ data: { organizationId: org.orgId, vendorId, number: 'PO-ITEM', date, status: 'APPROVED' } });
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, poId: po.id, number: 'RECEIPT-ITEM', issueDate: date, status: 'DRAFT', subtotal: 300, totalAmount: 300 } });
  await prisma.$transaction(tx => postGoodsReceiptToLedger(tx, org.orgId, { billId: bill.id, poNumber: po.number, date, taxInclusive: false, taxRate: 0,
    lines: [{ itemId: a.id, quantity: 1, lineTotal: 100 }, { itemId: b.id, quantity: 1, lineTotal: 200 }] }));
  return { org, asset, a, b, bill };
}

describe('goods receipt item accounts', () => {
  it('blank accounts preserve the original receipt and reversal journal', async () => {
    const f = await fixture(false);
    const initial = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'Goods receipt: PO PO-ITEM' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const expected = initial.lines.map(line => ({ account: line.accountId, debit: Number(line.debit), credit: Number(line.credit) }));
    expect(expected).toEqual([{ account: f.org.accounts.inventoryAsset, debit: 300, credit: 0 }, { account: f.org.accounts.grIrClearing, debit: 0, credit: 300 }]);
    await prisma.$transaction(tx => unreceiveGoodsReceipt(tx, f.org.orgId, f.bill.id, { date }));
    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'Un-receive: RECEIPT-ITEM' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(reversal.lines.map(line => ({ account: line.accountId, debit: Number(line.debit), credit: Number(line.credit) }))).toEqual([
      { account: f.org.accounts.grIrClearing, debit: 300, credit: 0 }, { account: f.org.accounts.inventoryAsset, debit: 0, credit: 300 },
    ]);
  });
  it('uses mixed item accounts and reverses the recorded receipt after mappings change', async () => {
    const f = await fixture(true);
    expect(await accountBalance(f.org.orgId, f.asset.id)).toBe(100);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(200);
    const movements = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: f.org.orgId, documentId: f.bill.id, documentType: 'PURCHASE' } });
    expect(movements.find(row => row.itemId === f.a.id)?.inventoryPostingAccountId).toBe(f.asset.id);
    expect(movements.find(row => row.itemId === f.b.id)?.inventoryPostingAccountId).toBe(f.org.accounts.inventoryAsset);
    // Bypass the edit guard to model a historical mapping change.
    await prisma.item.update({ where: { id: f.a.id }, data: { inventoryAccountId: f.org.accounts.inventoryAsset } });
    await prisma.$transaction(tx => unreceiveGoodsReceipt(tx, f.org.orgId, f.bill.id, { date }));
    expect(await accountBalance(f.org.orgId, f.asset.id)).toBe(0);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
  });
  it('refuses an untracked historical receipt and rolls back its stock and document changes', async () => {
    const f = await fixture(true);
    await prisma.bill.update({ where: { id: f.bill.id }, data: { receiptPostingJournalId: null } });
    const before = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });
    await expect(prisma.$transaction(tx => unreceiveGoodsReceipt(tx, f.org.orgId, f.bill.id, { date }))).rejects.toThrow(/original receipt account history is unavailable/i);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: f.bill.id } })).deletedAt).toBeNull();
    expect(await prisma.inventoryLot.count({ where: { organizationId: f.org.orgId, documentId: f.bill.id } })).toBe(2);
    expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(before);
  });
});
