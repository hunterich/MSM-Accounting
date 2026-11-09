import { afterAll, describe, expect, it } from 'vitest';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { voidStockAdjustment } from '@/lib/stock-adjustment-void';
import { accountBalance, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');

async function fixture(custom: boolean) {
  const org = await createTestOrg();
  const inventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item inventory', type: 'ASSET', normalSide: 'DEBIT' } });
  const first = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'ADJ-A', name: 'A', inventoryAccountId: custom ? inventory.id : null } });
  const second = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'ADJ-B', name: 'B', openingStock: 1, costPrice: 100 } });
  await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, second.id, date));
  const adjustment = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'ADJ-ITEM', date, reason: 'Count' } });
  const args = { id: adjustment.id, number: adjustment.number, date, warehouseId: null, lines: [
    { itemId: first.id, oldQty: 0, newQty: 1, unitCost: 100 },
    { itemId: second.id, oldQty: 1, newQty: 0, unitCost: 100 },
  ] };
  return { org, inventory, first, second, adjustment, args };
}

describe('stock adjustment item accounts', () => {
  it('blank accounts preserve the original net-zero result', async () => {
    const f = await fixture(false);
    await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, f.args));
    expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId, memo: 'Stock adjustment: ADJ-ITEM' } })).toBe(0);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(100);
  });
  it('posts and voids equal changes on different inventory accounts', async () => {
    const f = await fixture(true);
    await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, f.args));
    expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(100);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'Stock adjustment: ADJ-ITEM' }, include: { lines: true } });
    expect(entry.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)]).sort()).toEqual([[f.inventory.id, 100, 0], [f.org.accounts.inventoryAsset, 0, 100]].sort());
    await prisma.item.update({ where: { id: f.first.id }, data: { inventoryAccountId: f.org.accounts.inventoryAsset } });
    await prisma.$transaction(tx => voidStockAdjustment(tx, f.org.orgId, f.adjustment.id, { date }));
    expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(0);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(100);
  });
  it('refuses old untracked stock without leaving a partial adjustment', async () => {
    const f = await fixture(true);
    await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: f.org.orgId, itemId: f.second.id }, data: { inventoryPostingAccountId: null } });
    await expect(prisma.$transaction(tx => postStockAdjustmentToLedger(tx, f.org.orgId, f.args))).rejects.toThrow(/account history is unavailable/i);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, documentId: f.adjustment.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId, memo: 'Stock adjustment: ADJ-ITEM' } })).toBe(0);
  });
});
