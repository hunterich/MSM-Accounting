import { afterAll, describe, expect, it } from 'vitest';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { accountBalance, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');
async function fixture(custom: boolean) {
  const org = await createTestOrg();
  const account = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'POS inventory', type: 'ASSET', normalSide: 'DEBIT' } });
  const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'POS-ITEM', name: 'POS item', inventoryAccountId: custom ? account.id : null } });
  const input = { itemId: item.id, warehouseId: org.warehouseId, batchNumber: 'ITEM-BATCH', expiryDate: new Date('2027-01-01'), qty: 2, unitCost: 100, date };
  return { org, account, item, input };
}
describe('POS stock-in item account', () => {
  it('blank accounts preserve the original journal', async () => {
    const f = await fixture(false);
    await prisma.$transaction(tx => receiveBatch(tx, f.org.orgId, f.input));
    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'POS batch receipt: ITEM-BATCH' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(journal.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)])).toEqual([[f.org.accounts.inventoryAsset, 200, 0], [f.org.accounts.openingBalanceEquity, 0, 200]]);
  });
  it('records the item inventory account for the journal and movement', async () => {
    const f = await fixture(true);
    const id = await prisma.$transaction(tx => receiveBatch(tx, f.org.orgId, f.input));
    expect(await accountBalance(f.org.orgId, f.account.id)).toBe(200);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
    const movement = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: id } });
    expect(movement.inventoryPostingAccountId).toBe(f.account.id);
  });
  it('rejects an invalid account before creating a batch or journal', async () => {
    const f = await fixture(false);
    await prisma.item.update({ where: { id: f.item.id }, data: { inventoryAccountId: f.org.accounts.salesRevenue } });
    await expect(prisma.$transaction(tx => receiveBatch(tx, f.org.orgId, f.input))).rejects.toThrow(/inventory item account/i);
    expect(await prisma.stockBatch.count({ where: { organizationId: f.org.orgId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(0);
  });
});
