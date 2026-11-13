import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '@/lib/bill-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { voidPurchaseReturn } from '@/lib/return-void';
import { accountBalance, createTestOrg, createVendor, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');

async function fixture(custom: boolean, method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'FIFO') {
  const org = await createTestOrg({ costingMethod: method });
  const vendorId = await createVendor(org.orgId);
  const inventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item inventory', type: 'ASSET', normalSide: 'DEBIT' } });
  const first = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'PR-A', name: 'A', inventoryAccountId: custom ? inventory.id : null } });
  const second = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'PR-B', name: 'B' } });
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'PR-BILL', issueDate: date, status: 'OPEN', subtotal: 300, totalAmount: 300, lines: { create: [
    { lineNo: 1, itemId: first.id, description: 'A', quantity: 1, price: 100, lineTotal: 100 },
    { lineNo: 2, itemId: second.id, description: 'B', quantity: 1, price: 200, lineTotal: 200 },
  ] } }, include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  const ret = await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId, billId: bill.id, number: 'PR-ITEM', returnDate: date, status: 'APPROVED', returnAccountId: org.accounts.apControl, lines: { create: [
    { lineNo: 1, itemId: first.id, description: 'A', qtyReturn: 1 },
    { lineNo: 2, itemId: second.id, description: 'B', qtyReturn: 1 },
  ] } } });
  return { org, inventory, first, second, bill, ret };
}

describe('purchase returns follow recorded stock accounts', () => {
  it('blank accounts preserve the original return journal', async () => {
    const f = await fixture(false);
    await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, f.ret.id));
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'Purchase return inventory: PR-ITEM' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(entry.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)])).toEqual([[f.org.accounts.apControl, 300, 0], [f.org.accounts.inventoryAsset, 0, 300]]);
  });
  for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) {
    it(`${method}: posts mixed accounts and restores recorded accounts on void`, async () => {
      const f = await fixture(true, method);
      await prisma.item.update({ where: { id: f.first.id }, data: { inventoryAccountId: f.org.accounts.inventoryAsset } });
      await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, f.ret.id));
      expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
      const outbound = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: f.org.orgId, documentId: f.ret.id, documentType: 'PURCHASE_RETURN' } });
      expect(outbound.find(m => m.itemId === f.first.id)?.inventoryPostingAccountId).toBe(f.inventory.id);
      expect(outbound.find(m => m.itemId === f.second.id)?.inventoryPostingAccountId).toBe(f.org.accounts.inventoryAsset);
      await prisma.$transaction(tx => voidPurchaseReturn(tx, f.org.orgId, f.ret.id, { date }));
      expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(100);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(200);
      const restored = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: f.org.orgId, itemId: f.first.id, documentId: f.ret.id }, include: { inboundLedgerEntry: true } });
      expect(restored.inboundLedgerEntry?.inventoryPostingAccountId).toBe(f.inventory.id);
    });
  }
  it('rejects old untracked stock without leaving partial movements or journals', async () => {
    const f = await fixture(true);
    await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: f.org.orgId, documentId: f.bill.id, itemId: f.first.id }, data: { inventoryPostingAccountId: null } });
    const before = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });
    await expect(prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, f.ret.id))).rejects.toThrow(/account history is unavailable/i);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, documentId: f.ret.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(before);
    expect(Number((await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: f.org.orgId, itemId: f.first.id } })).qtyBalance)).toBe(1);
  });
});
