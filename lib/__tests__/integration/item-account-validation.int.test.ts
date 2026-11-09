import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createItemRoute } from '@/src/app/api/v1/items/route';
import { PUT as updateItemRoute } from '@/src/app/api/v1/items/[id]/route';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { lockInventoryItems } from '@/lib/inventory-costing';
import { createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);
function request(orgId: string, userId: string, method: string, body: unknown) {
  return new NextRequest('http://localhost/api/v1/items', { method, headers: { 'content-type': 'application/json', 'x-org-id': orgId, 'x-user-id': userId, 'x-role-type': 'ADMIN' }, body: JSON.stringify(body) });
}

describe('item account validation', () => {
  it('accepts company-owned role-appropriate accounts and rejects invalid mappings without creating or changing items', async () => {
    const org = await createTestOrg();
    const foreign = await createTestOrg();
    const actor = await prisma.user.create({ data: { email: `item-audit-${org.orgId}@test.invalid`, fullName: 'Test Admin' } });
    const inactive = await prisma.account.create({ data: { organizationId: org.orgId, code: '1391', name: 'Inactive', type: 'ASSET', normalSide: 'DEBIT', isActive: false } });
    const header = await prisma.account.create({ data: { organizationId: org.orgId, code: '1392', name: 'Header', type: 'ASSET', normalSide: 'DEBIT', isPostable: false } });
    const base = { sku: 'MAPPING-CREATE', name: 'Mapping test', inventoryAccountId: org.accounts.inventoryAsset, revenueAccountId: org.accounts.salesRevenue, cogsAccountId: org.accounts.cogsExpense };
    for (const [field, id] of [
      ['inventoryAccountId', foreign.accounts.inventoryAsset],
      ['inventoryAccountId', inactive.id],
      ['inventoryAccountId', header.id],
      ['inventoryAccountId', org.accounts.salesRevenue],
      ['revenueAccountId', org.accounts.inventoryAsset],
      ['cogsAccountId', org.accounts.salesRevenue],
    ]) {
      const response = await createItemRoute(request(org.orgId, actor.id, 'POST', { ...base, [field]: id }), {});
      expect(response.status).toBe(404);
      expect(await prisma.item.count({ where: { organizationId: org.orgId, sku: base.sku } })).toBe(0);
    }
    const created = await createItemRoute(request(org.orgId, actor.id, 'POST', base), {});
    expect(created.status).toBe(201);
    const item = await prisma.item.findFirstOrThrow({ where: { organizationId: org.orgId, sku: base.sku } });
    const rejected = await updateItemRoute(request(org.orgId, actor.id, 'PUT', { cogsAccountId: org.accounts.inventoryAsset }), { params: Promise.resolve({ id: item.id }) });
    expect(rejected.status).toBe(404);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).cogsAccountId).toBe(org.accounts.cogsExpense);
  });
  it('rolls back opening inventory when a legacy item has an invalid stored account', async () => {
    const org = await createTestOrg();
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'INVALID-OPEN', name: 'Legacy item', openingStock: 2, costPrice: 100, inventoryAccountId: org.accounts.salesRevenue } });
    await expect(prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, new Date('2026-01-01')))).rejects.toThrow(/active, postable inventory asset/);
    expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId, itemId: item.id } })).toBe(0);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId, itemId: item.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
  });
  it('blocks account changes while stock exists, permits unchanged mappings and permits change once a never-stocked item is clear', async () => {
    const org = await createTestOrg();
    const actor = await prisma.user.create({ data: { email: `stock-guard-${org.orgId}@test.invalid`, fullName: 'Test Admin' } });
    const other = await prisma.account.create({ data: { organizationId: org.orgId, code: '1393', name: 'Other inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const stocked = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'STOCKED', name: 'Stocked', openingStock: 2, costPrice: 100, inventoryAccountId: org.accounts.inventoryAsset } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, stocked.id, new Date('2026-01-01')));
    const context = { params: Promise.resolve({ id: stocked.id }) };
    expect((await updateItemRoute(request(org.orgId, actor.id, 'PUT', { inventoryAccountId: other.id }), context)).status).toBe(409);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: stocked.id } })).inventoryAccountId).toBe(org.accounts.inventoryAsset);
    expect((await updateItemRoute(request(org.orgId, actor.id, 'PUT', { inventoryAccountId: org.accounts.inventoryAsset }), context)).status).toBe(200);
    const empty = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'EMPTY', name: 'Empty', inventoryAccountId: org.accounts.inventoryAsset } });
    expect((await updateItemRoute(request(org.orgId, actor.id, 'PUT', { inventoryAccountId: other.id }), { params: Promise.resolve({ id: empty.id }) })).status).toBe(200);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: empty.id } })).inventoryAccountId).toBe(other.id);
  });
  it('cannot hide stock with offsetting warehouse balances', async () => {
    const org = await createTestOrg();
    const actor = await prisma.user.create({ data: { email: `stock-pools-${org.orgId}@test.invalid`, fullName: 'Test Admin' } });
    const other = await prisma.account.create({ data: { organizationId: org.orgId, code: '1394', name: 'Other inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'POOLS', name: 'Pools', inventoryAccountId: org.accounts.inventoryAsset } });
    await prisma.inventoryLedgerEntry.createMany({ data: [
      { organizationId: org.orgId, itemId: item.id, warehouseId: org.warehouseId, date: new Date('2026-01-01'), documentType: 'PURCHASE', documentId: 'positive', qtyIn: 1, valueChange: 100 },
      { organizationId: org.orgId, itemId: item.id, date: new Date('2026-01-01'), documentType: 'SALES', documentId: 'negative', qtyOut: 1, valueChange: -100 },
    ] });
    const response = await updateItemRoute(request(org.orgId, actor.id, 'PUT', { inventoryAccountId: other.id }), { params: Promise.resolve({ id: item.id }) });
    expect(response.status).toBe(409);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).inventoryAccountId).toBe(org.accounts.inventoryAsset);
  });
  it('can set a new account and post first opening stock in one update', async () => {
    const org = await createTestOrg();
    const actor = await prisma.user.create({ data: { email: `stock-opening-${org.orgId}@test.invalid`, fullName: 'Test Admin' } });
    const other = await prisma.account.create({ data: { organizationId: org.orgId, code: '1396', name: 'Other inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'OPEN-NEW', name: 'Opening', costPrice: 100, inventoryAccountId: org.accounts.inventoryAsset } });
    const response = await updateItemRoute(request(org.orgId, actor.id, 'PUT', { inventoryAccountId: other.id, openingStock: 2 }), { params: Promise.resolve({ id: item.id }) });
    expect(response.status).toBe(200);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.orgId, memo: 'Opening stock: OPEN-NEW' }, include: { lines: true } });
    expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: other.id })]));
    expect(Number(entry.lines.find(line => line.accountId === other.id)?.debit)).toBe(200);
    expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId, itemId: item.id } })).toBe(1);
  });
  it('waits for a concurrent stock write and checks the newly committed balance', async () => {
    const org = await createTestOrg();
    const actor = await prisma.user.create({ data: { email: `stock-race-${org.orgId}@test.invalid`, fullName: 'Test Admin' } });
    const other = await prisma.account.create({ data: { organizationId: org.orgId, code: '1395', name: 'Other inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'RACE', name: 'Race', inventoryAccountId: org.accounts.inventoryAsset } });
    let release!: () => void; let locked!: (pid: number) => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<number>(resolve => { locked = resolve; });
    const writer = prisma.$transaction(async tx => {
      await lockInventoryItems(tx, org.orgId, [item.id]);
      await tx.inventoryLedgerEntry.create({ data: { organizationId: org.orgId, itemId: item.id, date: new Date('2026-01-01'), documentType: 'PURCHASE', documentId: 'race', qtyIn: 1, valueChange: 100 } });
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      locked(row.pid); await hold;
    }, { timeout: 15000 });
    const pid = await ready;
    const updating = updateItemRoute(request(org.orgId, actor.id, 'PUT', { inventoryAccountId: other.id }), { params: Promise.resolve({ id: item.id }) });
    let blocked = false;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { release(); }
    await writer;
    expect(blocked).toBe(true);
    expect((await updating).status).toBe(409);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).inventoryAccountId).toBe(org.accounts.inventoryAsset);
  });
});
