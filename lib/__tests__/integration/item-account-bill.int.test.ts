import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '@/lib/bill-posting';
import { voidBill } from '@/lib/bill-void';
import { accountBalance, createTestOrg, createVendor, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');

async function fixture(custom: boolean) {
  const org = await createTestOrg();
  const vendorId = await createVendor(org.orgId);
  const inventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item inventory', type: 'ASSET', normalSide: 'DEBIT' } });
  const first = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'BILL-A', name: 'A', inventoryAccountId: custom ? inventory.id : null } });
  const second = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'BILL-B', name: 'B' } });
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'DIRECT-ITEM', issueDate: date, status: 'OPEN', taxable: true, taxInclusive: true, taxRate: 11, subtotal: 300, taxAmount: 33, totalAmount: 333, lines: { create: [
    { lineNo: 1, itemId: first.id, description: 'A', quantity: 1, price: 111, lineTotal: 111 },
    { lineNo: 2, itemId: second.id, description: 'B', quantity: 1, price: 222, lineTotal: 222 },
  ] } }, include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  return { org, inventory, first, second, bill };
}

describe('direct bill item accounts', () => {
  it('blank accounts preserve the original journal', async () => {
    const f = await fixture(false);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'Bill: DIRECT-ITEM' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(entry.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)])).toEqual([
      [f.org.accounts.inventoryAsset, 300, 0], [f.org.accounts.apTax, 33, 0], [f.org.accounts.apControl, 0, 333],
    ]);
  });
  it('posts mixed accounts, tax and original accounts on void', async () => {
    const f = await fixture(true);
    expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(100);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(200);
    const movements = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: f.org.orgId, documentId: f.bill.id, documentType: 'PURCHASE' } });
    expect(movements.find(m => m.itemId === f.first.id)?.inventoryPostingAccountId).toBe(f.inventory.id);
    expect(movements.find(m => m.itemId === f.second.id)?.inventoryPostingAccountId).toBe(f.org.accounts.inventoryAsset);
    await prisma.item.update({ where: { id: f.first.id }, data: { inventoryAccountId: f.org.accounts.inventoryAsset } });
    await prisma.$transaction(tx => voidBill(tx, f.org.orgId, f.bill.id, { date }));
    expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(0);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
  });
});
