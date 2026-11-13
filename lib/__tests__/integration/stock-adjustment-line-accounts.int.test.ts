import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approveRequest } from '../../approval/engine';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { voidStockAdjustment } from '../../stock-adjustment-void';
import { postStockCount } from '../../stock-count-posting';
import { prisma, createTestOrg, createItem, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue } from './harness';

const date = new Date('2026-06-23T00:00:00Z');
afterAll(disconnect);

async function journal(orgId: string, memo: string) {
  return prisma.journalEntry.findFirstOrThrow({ where: { organizationId: orgId, memo }, include: { lines: true } });
}

describe('stock adjustment line-account posting', () => {
  for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) {
    it(`${method}: splits lot cost and reverses the exact journal`, async () => {
      const org = await createTestOrg({ costingMethod: method });
      try {
        const itemId = await createItem(org.orgId, 10000);
        const receivable = await prisma.account.create({ data: { organizationId: org.orgId, code: '1998', name: 'Employee receivable', type: 'ASSET', normalSide: 'DEBIT' } });
        await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: 'seed', number: 'SEED', date, warehouseId: null, lines: [{ itemId, oldQty: 0, newQty: 4, unitCost: 10000 }] }));
        const adj = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'SPLIT', date, reason: 'Test', status: 'APPROVED', postsLineAccounts: true } });
        await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { ...adj, lines: [
          { itemId, oldQty: 4, newQty: 3, unitCost: 10000, accountId: org.accounts.cogsExpense },
          { itemId, oldQty: 3, newQty: 2, unitCost: 10000, accountId: receivable.id },
        ] }));
        const forward = await journal(org.orgId, 'Stock adjustment: SPLIT');
        const amounts = forward.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)]);
        expect(amounts).toEqual(expect.arrayContaining([[org.accounts.cogsExpense, 10000, 0], [receivable.id, 10000, 0], [org.accounts.inventoryAsset, 0, 20000]]));
        expect(amounts).toHaveLength(3);
        expect(await inventoryLedgerValue(org.orgId)).toBe(await accountBalance(org.orgId, org.accounts.inventoryAsset));
        await prisma.$transaction(tx => voidStockAdjustment(tx, org.orgId, adj.id, { date }));
        const reverse = await journal(org.orgId, 'Void stock adjustment: SPLIT');
        expect(reverse.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)])).toEqual(expect.arrayContaining(amounts.map(([id, debit, credit]) => [id, credit, debit])));
        expect(reverse.lines).toHaveLength(amounts.length);
        expect(await inventoryLedgerValue(org.orgId)).toBe(await accountBalance(org.orgId, org.accounts.inventoryAsset));
      } finally { await cleanupOrg(org.orgId); }
    });
  }

  for (const postsLineAccounts of [true, false]) {
    it(`approval preserves postsLineAccounts=${postsLineAccounts}`, async () => {
      const org = await createTestOrg();
      const user = await prisma.user.create({ data: { email: `${randomUUID()}@line-account.test`, fullName: 'Test' } });
      try {
        const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
        await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
        const itemId = await createItem(org.orgId, 10000);
        const adj = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'PENDING', date, reason: 'Test', status: 'PENDING_APPROVAL', postsLineAccounts, lines: { create: { lineNo: 1, itemId, accountId: org.accounts.cogsExpense, oldQty: 0, newQty: 1, qtyDiff: 1, unitCost: 10000, totalValue: 10000 } } } });
        const request = await prisma.approvalRequest.create({ data: { organizationId: org.orgId, documentType: 'STOCK_ADJUSTMENT', documentId: adj.id, requestedById: user.id } });
        await approveRequest(request.id, { orgId: org.orgId, userId: user.id, roleType: 'ADMIN' });
        const entry = await journal(org.orgId, 'Stock adjustment: PENDING');
        expect(entry.lines.some(l => l.accountId === (postsLineAccounts ? org.accounts.cogsExpense : org.accounts.inventoryAdjustment) && Number(l.credit) === 10000)).toBe(true);
        expect(await inventoryLedgerValue(org.orgId)).toBe(await accountBalance(org.orgId, org.accounts.inventoryAsset));
      } finally { await prisma.approvalRequest.deleteMany({ where: { organizationId: org.orgId } }); await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined); }
    });
  }

  it('stock count uses the variance default', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 10000);
      const count = await prisma.stockCount.create({ data: { organizationId: org.orgId, number: 'COUNT', date, status: 'SUBMITTED' } });
      const id = await prisma.$transaction(tx => postStockCount(tx, org.orgId, { id: count.id, number: count.number, date, warehouseId: null, lines: [{ itemId, systemQty: 0, countedQty: 1, unitCost: 10000 }] }));
      const adj = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: id! } });
      const entry = await journal(org.orgId, `Stock adjustment: ${adj.number}`);
      expect(entry.lines.some(l => l.accountId === org.accounts.inventoryAdjustment && Number(l.credit) === 10000)).toBe(true);
      expect(await inventoryLedgerValue(org.orgId)).toBe(await accountBalance(org.orgId, org.accounts.inventoryAsset));
    } finally { await cleanupOrg(org.orgId); }
  });
});
