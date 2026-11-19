import { describe, expect, it } from 'vitest';
import { readStockMovement } from '../stock-movement';
import { computeLedgerValuation } from '../inventory-valuation';

interface Entry { itemId: string; warehouseId: string | null; date: Date; qtyIn: number; qtyOut: number; valueChange: number }

const items = [
  { id: 'a', sku: 'A-1', name: 'Apple' },
  { id: 'b', sku: 'B-1', name: 'Banana' },
];

// In-memory stand-in for the two Prisma calls the reader makes.
function fakeDb(entries: Entry[]) {
  const match = (e: Entry, where: any) =>
    (!where.itemId || (typeof where.itemId === 'string' ? e.itemId === where.itemId : where.itemId.in.includes(e.itemId)))
    && (!where.warehouseId || e.warehouseId === where.warehouseId)
    && (!where.date?.gte || e.date >= where.date.gte)
    && (!where.date?.lte || e.date <= where.date.lte);
  return {
    inventoryLedgerEntry: {
      groupBy: async ({ where }: any) => {
        const sums = new Map<string, { qtyIn: number; qtyOut: number; valueChange: number }>();
        for (const e of entries.filter(e => match(e, where))) {
          const s = sums.get(e.itemId) ?? { qtyIn: 0, qtyOut: 0, valueChange: 0 };
          s.qtyIn += e.qtyIn; s.qtyOut += e.qtyOut; s.valueChange += e.valueChange;
          sums.set(e.itemId, s);
        }
        return [...sums].map(([itemId, _sum]) => ({ itemId, _sum }));
      },
    },
    item: {
      findMany: async ({ where }: any) => items.filter(i => where.id.in.includes(i.id)),
    },
  } as any;
}

const d = (iso: string) => new Date(iso);
const entries: Entry[] = [
  // Before the period: 10 apples in WH-1, 4 out → opening 6 @ 6000.
  { itemId: 'a', warehouseId: 'wh1', date: d('2026-08-01T03:00:00Z'), qtyIn: 10, qtyOut: 0, valueChange: 10000 },
  { itemId: 'a', warehouseId: 'wh1', date: d('2026-08-15T03:00:00Z'), qtyIn: 0, qtyOut: 4, valueChange: -4000 },
  // Before the period, other warehouse: 3 apples in WH-2.
  { itemId: 'a', warehouseId: 'wh2', date: d('2026-08-20T03:00:00Z'), qtyIn: 3, qtyOut: 0, valueChange: 3300 },
  // Inside the period.
  { itemId: 'a', warehouseId: 'wh1', date: d('2026-09-10T03:00:00Z'), qtyIn: 5, qtyOut: 0, valueChange: 5500 },
  { itemId: 'a', warehouseId: 'wh1', date: d('2026-09-20T03:00:00Z'), qtyIn: 0, qtyOut: 2, valueChange: -2100 },
  { itemId: 'b', warehouseId: 'wh2', date: d('2026-09-12T03:00:00Z'), qtyIn: 7, qtyOut: 0, valueChange: 700 },
  // After the period: must not count.
  { itemId: 'a', warehouseId: 'wh1', date: d('2026-10-05T03:00:00Z'), qtyIn: 100, qtyOut: 0, valueChange: 100000 },
];
const dateFrom = d('2026-08-31T17:00:00.000Z'); // 2026-09-01 Jakarta
const dateTo = d('2026-09-30T16:59:59.999Z');   // 2026-09-30 Jakarta

describe('readStockMovement', () => {
  it('starts each item from its opening balance before dateFrom, not zero', async () => {
    const rows = await readStockMovement(fakeDb(entries), 'org', { dateFrom, dateTo });
    expect(rows).toEqual([
      { itemId: 'a', sku: 'A-1', itemName: 'Apple', openingBalance: 9, openingValue: 9300, totalIn: 5, totalOut: 2, movementValue: 3400, closingBalance: 12, closingValue: 12700 },
      { itemId: 'b', sku: 'B-1', itemName: 'Banana', openingBalance: 0, openingValue: 0, totalIn: 7, totalOut: 0, movementValue: 700, closingBalance: 7, closingValue: 700 },
    ]);
  });

  it('closing balance equals the ledger valuation as of dateTo', async () => {
    const db = fakeDb(entries);
    for (const warehouseId of [null, 'wh1', 'wh2']) {
      const rows = await readStockMovement(db, 'org', { dateFrom, dateTo, warehouseId });
      const valuation = await computeLedgerValuation(db, 'org', { warehouseId, asOfDate: dateTo });
      for (const row of rows) {
        expect(row.closingBalance).toBe(valuation.get(row.itemId)?.totalQty ?? 0);
        expect(row.closingValue).toBe(valuation.get(row.itemId)?.totalValue ?? 0);
      }
      expect(rows.map(r => r.itemId).sort()).toEqual([...valuation.keys()].sort());
    }
  });

  it('filters by warehouse, including the opening balance', async () => {
    const rows = await readStockMovement(fakeDb(entries), 'org', { dateFrom, dateTo, warehouseId: 'wh2' });
    expect(rows).toEqual([
      { itemId: 'a', sku: 'A-1', itemName: 'Apple', openingBalance: 3, openingValue: 3300, totalIn: 0, totalOut: 0, movementValue: 0, closingBalance: 3, closingValue: 3300 },
      { itemId: 'b', sku: 'B-1', itemName: 'Banana', openingBalance: 0, openingValue: 0, totalIn: 7, totalOut: 0, movementValue: 700, closingBalance: 7, closingValue: 700 },
    ]);
  });

  it('lists an item with stock on hand but no movement in the period', async () => {
    const rows = await readStockMovement(fakeDb(entries), 'org', { dateFrom: d('2026-10-31T17:00:00Z'), dateTo: d('2026-11-30T16:59:59.999Z'), itemId: 'b' });
    expect(rows).toEqual([
      { itemId: 'b', sku: 'B-1', itemName: 'Banana', openingBalance: 7, openingValue: 700, totalIn: 0, totalOut: 0, movementValue: 0, closingBalance: 7, closingValue: 700 },
    ]);
  });
});
