import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approveRequest } from '../../approval/engine';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { voidStockAdjustment } from '../../stock-adjustment-void';
import { postStockCount } from '../../stock-count-posting';
import { postBillToLedger } from '../../bill-posting';
import { NextRequest } from 'next/server';
import { POST as createAdjustment } from '../../../src/app/api/v1/stock-adjustments/route';
import { PUT as editAdjustment } from '../../../src/app/api/v1/stock-adjustments/[id]/route';
import { prisma, createTestOrg, createItem, createVendor, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue } from './harness';

const date = new Date('2026-06-23T00:00:00Z');
afterAll(disconnect);

async function journal(orgId: string, memo: string) {
  return prisma.journalEntry.findFirstOrThrow({ where: { organizationId: orgId, memo }, include: { lines: true } });
}

describe('stock adjustment line-account posting', () => {
  it('API enables line accounts on create and preserves the legacy flag on edit', async () => {
    const org = await createTestOrg();
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@line-route.test`, fullName: 'Test' } });
    try {
      const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
      await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
      const itemId = await createItem(org.orgId, 10000);
      const request = (method: string, body: unknown) => new NextRequest('http://localhost/api/v1/stock-adjustments', { method, headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const line = { itemId, accountId: org.accounts.cogsExpense, oldQty: 0, newQty: 1, unitCost: 10000 };
      const created = await createAdjustment(request('POST', { date: '2026-06-23', type: 'QUANTITY', reason: 'Test', status: 'DRAFT', lines: [line] }));
      expect(created.status).toBe(201);
      const payload = await created.json();
      const newDoc = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: payload.id } });
      expect(newDoc.postsLineAccounts).toBe(true);
      const legacy = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'LEGACY', date, reason: 'Test', postsLineAccounts: false } });
      const edited = await editAdjustment(request('PUT', { lines: [{ ...line, accountId: org.accounts.inventoryAsset }] }), { params: Promise.resolve({ id: legacy.id }) });
      expect(edited.status).toBe(200);
      expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: legacy.id } })).postsLineAccounts).toBe(false);
      const rejectedCreate = await createAdjustment(request('POST', { date: '2026-06-23', type: 'QUANTITY', reason: 'Test', status: 'DRAFT', lines: [{ ...line, accountId: org.accounts.inventoryAsset }] }));
      expect(rejectedCreate.status).toBe(422);
      const rejectedEdit = await editAdjustment(request('PUT', { lines: [{ ...line, accountId: org.accounts.inventoryAsset }] }), { params: Promise.resolve({ id: newDoc.id }) });
      expect(rejectedEdit.status).toBe(422);
    } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined); }
  });

  it('rejects another item inventory account and rolls back every posting side effect', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId, 10000);
      const otherItemId = await createItem(org.orgId, 10000);
      const otherInventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1399', name: 'Other inventory', type: 'ASSET', normalSide: 'DEBIT' } });
      await prisma.item.update({ where: { id: otherItemId }, data: { inventoryAccountId: otherInventory.id } });
      await expect(prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: 'REJECTED', number: 'REJECTED', date, warehouseId: null, postsLineAccounts: true, lines: [{ itemId, oldQty: 0, newQty: 1, unitCost: 10000, accountId: otherInventory.id }] }))).rejects.toMatchObject({ status: 422 });
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
      expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId } })).toBe(0);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('weighted average splits an uneven pool to the cent', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    try {
      const itemId = await createItem(org.orgId, 10000);
      const vendorId = await createVendor(org.orgId);
      const receivable = await prisma.account.create({ data: { organizationId: org.orgId, code: '1998', name: 'Employee receivable', type: 'ASSET', normalSide: 'DEBIT' } });
      for (const [number, qty, price] of [['WA-1', 1, 10000], ['WA-2', 2, 10001]] as const) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: date, status: 'OPEN', subtotal: qty * price, totalAmount: qty * price, lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: qty, price, lineTotal: qty * price } } }, include: { lines: true } });
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      }
      await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: 'WA-SPLIT', number: 'WA-SPLIT', date, warehouseId: null, postsLineAccounts: true, lines: [
        { itemId, oldQty: 3, newQty: 2, unitCost: 10000, accountId: org.accounts.cogsExpense },
        { itemId, oldQty: 2, newQty: 0, unitCost: 10000, accountId: receivable.id },
      ] }));
      const entry = await journal(org.orgId, 'Stock adjustment: WA-SPLIT');
      const ledger = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId, documentType: 'ADJUSTMENT', documentId: 'WA-SPLIT' }, orderBy: { postingSequence: 'asc' } });
      const debit = (id: string) => Number(entry.lines.find(line => line.accountId === id)?.debit);
      expect(ledger).toHaveLength(2);
      expect(debit(org.accounts.cogsExpense)).toBe(-Number(ledger[0].valueChange));
      expect(debit(receivable.id)).toBe(-Number(ledger[1].valueChange));
      expect(Math.round((debit(org.accounts.cogsExpense) + debit(receivable.id)) * 100)).toBe(3000200);
      expect(Number(entry.totalDebit)).toBe(30002);
      expect(Number(entry.totalCredit)).toBe(30002);
      expect(await inventoryLedgerValue(org.orgId)).toBe(0);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(0);
    } finally { await cleanupOrg(org.orgId); }
  });
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
