/**
 * Regression for #239: the Stock Movement report must start each item from its
 * opening balance before dateFrom (not zero), filter by warehouse, and close at
 * the same quantity and value as Stock Valuation as of dateTo.
 *
 * Run with:  npm run test:int -- stock-movement-report
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { GET as getGlReport } from '@/src/app/api/v1/reports/gl/route';
import { GET as getValuation } from '@/src/app/api/v1/inventory/valuation/route';
import { prisma, createTestOrg, createItem, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

function get(path: string, orgId: string, params: Record<string, string>) {
  const url = new URL(path, 'http://localhost');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, {
    headers: { 'x-org-id': orgId, 'x-user-id': `stock-movement-${randomUUID()}`, 'x-role-type': 'ADMIN' },
  });
}

async function adjust(org: TestOrg, itemId: string, warehouseId: string, date: string, oldQty: number, newQty: number, unitCost: number) {
  const id = `adj-${randomUUID()}`;
  await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, {
    id, number: id.slice(0, 16), date: new Date(date), warehouseId,
    lines: [{ itemId, oldQty, newQty, unitCost }],
  }));
}

describe('Stock Movement report (#239)', () => {
  it('opens from prior movements, filters by warehouse, and closes at Stock Valuation', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    try {
      const wh2 = await prisma.warehouse.create({ data: { organizationId: org.orgId, code: 'WH-2', name: 'Second' }, select: { id: true } });
      const itemId = await createItem(org.orgId, 1000);

      // Before September: WH-1 +10 then −4, WH-2 +3.
      await adjust(org, itemId, org.warehouseId, '2026-08-05T03:00:00Z', 0, 10, 1000);
      await adjust(org, itemId, org.warehouseId, '2026-08-20T03:00:00Z', 10, 6, 1000);
      await adjust(org, itemId, wh2.id, '2026-08-25T03:00:00Z', 0, 3, 1100);
      // 01:00 on 1 September in Jakarta: inside the period, not the opening.
      await adjust(org, itemId, org.warehouseId, '2026-08-31T18:00:00Z', 6, 11, 1200);
      await adjust(org, itemId, org.warehouseId, '2026-09-20T03:00:00Z', 11, 9, 1000);
      // After the period: must not count.
      await adjust(org, itemId, org.warehouseId, '2026-10-05T03:00:00Z', 9, 109, 1000);

      for (const warehouseId of [undefined, org.warehouseId, wh2.id]) {
        const scope: Record<string, string> = warehouseId ? { warehouseId } : {};
        const res = await getGlReport(get('/api/v1/reports/gl', org.orgId, { type: 'stock-movement', dateFrom: '2026-09-01', dateTo: '2026-09-30', ...scope }));
        expect(res.status).toBe(200);
        const body = await res.json();
        const [row] = body.rows;

        const opening = await (await getValuation(get('/api/v1/inventory/valuation', org.orgId, { asOfDate: '2026-08-31', ...scope }))).json();
        const closing = await (await getValuation(get('/api/v1/inventory/valuation', org.orgId, { asOfDate: '2026-09-30', ...scope }))).json();
        const openingItem = opening.items.find((i: { itemId: string }) => i.itemId === itemId);
        const closingItem = closing.items.find((i: { itemId: string }) => i.itemId === itemId);

        expect(row.openingBalance).toBe(openingItem.totalQty);
        expect(row.openingValue).toBe(openingItem.totalValue);
        expect(row.closingBalance).toBe(closingItem.totalQty);
        expect(row.closingValue).toBe(closingItem.totalValue);
        expect(row.closingBalance).toBe(row.openingBalance + row.totalIn - row.totalOut);
        expect(body.totals.closingValue).toBe(closing.summary.totalValue);
      }

      const all = await (await getGlReport(get('/api/v1/reports/gl', org.orgId, { type: 'stock-movement', dateFrom: '2026-09-01', dateTo: '2026-09-30' }))).json();
      expect(all.rows).toHaveLength(1);
      expect(all.rows[0]).toMatchObject({ openingBalance: 9, totalIn: 5, totalOut: 2, closingBalance: 12 });

      const second = await (await getGlReport(get('/api/v1/reports/gl', org.orgId, { type: 'stock-movement', dateFrom: '2026-09-01', dateTo: '2026-09-30', warehouseId: wh2.id }))).json();
      expect(second.rows[0]).toMatchObject({ openingBalance: 3, openingValue: 3300, totalIn: 0, totalOut: 0, closingBalance: 3, closingValue: 3300 });

      // Company-wide closing value ties to the GL inventory account at dateTo.
      const gl = await prisma.journalLine.aggregate({
        where: { accountId: org.accounts.inventoryAsset, entry: { organizationId: org.orgId, status: 'POSTED', date: { lte: new Date('2026-09-30T16:59:59.999Z') } } },
        _sum: { debit: true, credit: true },
      });
      expect(all.totals.closingValue).toBe(Number(gl._sum.debit) - Number(gl._sum.credit));
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
