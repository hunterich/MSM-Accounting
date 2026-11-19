/**
 * Stock Movement report: per item, the opening position before `dateFrom`, the
 * quantity in/out during the period, and the closing position at `dateTo`.
 *
 * Built from the same inventory ledger as Stock Valuation
 * (`computeLedgerValuation`), so the closing quantity and value equal Stock
 * Valuation as of `dateTo` for the same warehouse scope. Aggregated in SQL, so
 * the result has one row per item and never loads the raw ledger into memory.
 */
import type { Prisma } from '@prisma/client';
import { asMoney, toNumber } from './money';
import { computeLedgerValuation } from './inventory-valuation';

type Reader = Pick<Prisma.TransactionClient, 'inventoryLedgerEntry' | 'item'>;

export interface StockMovementSummaryRow {
  itemId: string;
  sku: string;
  itemName: string;
  openingBalance: number;
  openingValue: number;
  totalIn: number;
  totalOut: number;
  movementValue: number;
  closingBalance: number;
  closingValue: number;
}

const qty = (value: number) => Math.round(value * 10000) / 10000;

export async function readStockMovement(
  db: Reader,
  orgId: string,
  opts: { dateFrom: Date; dateTo: Date; itemId?: string | null; warehouseId?: string | null },
): Promise<StockMovementSummaryRow[]> {
  const opening = await computeLedgerValuation(db, orgId, {
    itemIds: opts.itemId ? [opts.itemId] : undefined,
    warehouseId: opts.warehouseId ?? null,
    asOfDate: new Date(opts.dateFrom.getTime() - 1),
  });

  const where: Prisma.InventoryLedgerEntryWhereInput = {
    organizationId: orgId,
    date: { gte: opts.dateFrom, lte: opts.dateTo },
  };
  if (opts.itemId) where.itemId = opts.itemId;
  if (opts.warehouseId) where.warehouseId = opts.warehouseId;
  const movements = await db.inventoryLedgerEntry.groupBy({
    by: ['itemId'],
    where,
    _sum: { qtyIn: true, qtyOut: true, valueChange: true },
  });
  const movementByItem = new Map(movements.map(m => [m.itemId, m._sum]));

  const itemIds = new Set(movementByItem.keys());
  for (const [itemId, o] of opening) if (o.totalQty !== 0 || o.totalValue !== 0) itemIds.add(itemId);
  if (itemIds.size === 0) return [];

  const items = await db.item.findMany({
    where: { organizationId: orgId, id: { in: [...itemIds] } },
    select: { id: true, sku: true, name: true },
  });

  return items
    .map((item) => {
      const o = opening.get(item.id);
      const m = movementByItem.get(item.id);
      const openingBalance = o?.totalQty ?? 0;
      const openingValue = o?.totalValue ?? 0;
      const totalIn = qty(toNumber(m?.qtyIn));
      const totalOut = qty(toNumber(m?.qtyOut));
      const movementValue = asMoney(toNumber(m?.valueChange));
      return {
        itemId: item.id,
        sku: item.sku,
        itemName: item.name,
        openingBalance,
        openingValue,
        totalIn,
        totalOut,
        movementValue,
        closingBalance: qty(openingBalance + totalIn - totalOut),
        closingValue: asMoney(openingValue + movementValue),
      };
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.sku.localeCompare(b.sku));
}
