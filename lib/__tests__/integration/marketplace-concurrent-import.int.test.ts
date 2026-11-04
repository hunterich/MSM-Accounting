import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { importMarketplaceOrders } from '@/lib/marketplace-import';
import { nextInvoiceNumber } from '@/lib/invoice-number';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect, accountBalance } from './harness';

afterAll(disconnect);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve }; }

it('concurrent imports of one order create one invoice, receipt and stock movement', async () => {
  const org = await createTestOrg();
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Race QA' } });
  const held = deferred(), release = deferred();
  let holder: Promise<unknown> | undefined;
  try {
    const customerId = await createCustomer(org.orgId);
    const bank = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Cash & Bank', bankName: 'Cash & Bank' } });
    const connection = await prisma.ecommerceConnection.create({ data: { organizationId: org.orgId, platform: 'SHOPEE', shopName: 'Race shop', customerId, holdingAccountId: bank.id } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'RACE', name: 'Race item', type: 'PRODUCT', unit: 'PCS', sellingPrice: 200, costPrice: 100, openingStock: 5, isActive: true } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, new Date('2026-01-01')));
    const order = { orderNo: 'RACE-1', issueDate: '2026-06-01', lines: [{ itemId: item.id, description: item.name, sku: item.sku, quantity: 1, unitPrice: 200 }] };
    holder = prisma.$transaction(async tx => { await nextInvoiceNumber(tx, org.orgId); held.resolve(); await release.promise; }, { timeout: 12000 });
    await held.promise;
    const calls = [1, 2].map(() => importMarketplaceOrders(org.orgId, user.id, connection.id, [order], { recordPayment: true }));
    try {
      let waiting = 0; const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`;
        waiting = Number(rows[0].n); if (waiting >= 2) break;
        await new Promise(done => setTimeout(done, 15));
      }
      expect(waiting, 'both imports must overlap at database locks').toBeGreaterThanOrEqual(2);
    } finally { release.resolve(); }
    const results = await Promise.all(calls); await holder;
    expect(results.map(r => r.created).sort()).toEqual([0, 1]);
    expect(results.map(r => r.skipped).sort()).toEqual([0, 1]);
    expect(results.flatMap(r => r.failed)).toEqual([]);
    expect(await prisma.salesInvoice.count({ where: { organizationId: org.orgId, poNumber: order.orderNo } })).toBe(1);
    expect(await prisma.aRPayment.count({ where: { organizationId: org.orgId } })).toBe(1);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId, documentType: 'SALES' } })).toBe(1);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(100);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(400);
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBe(0);
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBe(222);
  } finally { release.resolve(); if (holder) await holder; await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});

it('rolls back invoice, payment, journals and stock if receipt posting fails', async () => {
  const org = await createTestOrg();
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Rollback QA' } });
  try {
    const customerId = await createCustomer(org.orgId);
    const bank = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Cash & Bank', bankName: 'Cash & Bank' } });
    const connection = await prisma.ecommerceConnection.create({ data: { organizationId: org.orgId, platform: 'SHOPEE', shopName: 'Rollback shop', customerId, holdingAccountId: bank.id } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'ROLLBACK', name: 'Rollback item', type: 'PRODUCT', unit: 'PCS', sellingPrice: 200, costPrice: 100, openingStock: 5, isActive: true } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, new Date('2026-01-01')));
    await prisma.account.update({ where: { id: org.accounts.bankAsset }, data: { isActive: false } });
    const snapshot = async () => ({
      invoices: await prisma.salesInvoice.findMany({ where: { organizationId: org.orgId } }),
      payments: await prisma.aRPayment.findMany({ where: { organizationId: org.orgId } }),
      journals: await prisma.journalEntry.findMany({ where: { organizationId: org.orgId }, include: { lines: true }, orderBy: { id: 'asc' } }),
      lots: await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } }),
      ledger: await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();
    const order = { orderNo: 'ROLLBACK-1', issueDate: '2026-06-01', lines: [{ itemId: item.id, description: item.name, sku: item.sku, quantity: 1, unitPrice: 200 }] };
    const result = await importMarketplaceOrders(org.orgId, user.id, connection.id, [order], { recordPayment: true });
    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/cash|bank|deposit/i);
    expect(await snapshot()).toEqual(before);
  } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});

