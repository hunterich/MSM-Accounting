import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { lockInventoryItems } from './inventory-costing';
import { loadOrgAccountDefaults, resolveAccountDefaultId, type AccountDefaultsConfig } from './account-defaults';

/**
 * Items with a blank inventory account hold their stock on the company default.
 * Moving that default would strand it: later sales would be refused for
 * disagreeing with the recorded account. COGS and revenue defaults are safe to
 * change because no stock is held on them.
 */
export async function assertInventoryDefaultChangeAllowed(
  tx: Prisma.TransactionClient, organizationId: string, nextDefaults: Partial<AccountDefaultsConfig>,
) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  const accounts = await tx.account.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const current = resolveAccountDefaultId(accounts, await loadOrgAccountDefaults(tx, organizationId), 'inventoryAsset');
  if (current === resolveAccountDefaultId(accounts, nextDefaults, 'inventoryAsset')) return;

  const held = await tx.$queryRaw<unknown[]>`
    SELECT 1 FROM "InventoryLot" l JOIN "Item" i ON i."id" = l."itemId"
    WHERE l."organizationId" = ${organizationId} AND i."inventoryAccountId" IS NULL
      AND (l."qtyBalance" <> 0 OR COALESCE(l."carryingValue", 0) <> 0)
    UNION ALL
    SELECT 1 FROM "InventoryLedgerEntry" e JOIN "Item" i ON i."id" = e."itemId"
    WHERE e."organizationId" = ${organizationId} AND i."inventoryAccountId" IS NULL
    GROUP BY e."itemId", e."warehouseId"
    HAVING SUM(e."qtyIn") <> SUM(e."qtyOut") OR SUM(e."valueChange") <> 0
    LIMIT 1`;
  if (held.length) {
    throw new ApiError('Cannot change the default Inventory account while items using it hold stock or inventory value. Clear and reconcile that stock first.', 409);
  }
}

/** Called inside the update transaction, after the opening lock when applicable. */
export async function assertInventoryAccountChangeAllowed(
  tx: Prisma.TransactionClient, organizationId: string, itemId: string, newAccountId: string | null,
) {
  // Coordinate with stock posting paths that use the shared item lock.
  await lockInventoryItems(tx, organizationId, [itemId]);
  const item = await tx.item.findFirst({ where: { id: itemId, organizationId }, select: { inventoryAccountId: true } });
  if (!item) throw new ApiError('Item not found', 404);
  if (item.inventoryAccountId === newAccountId) return;

  const [pools, nonzeroLot] = await Promise.all([
    tx.inventoryLedgerEntry.groupBy({ by: ['warehouseId'], where: { organizationId, itemId },
      _sum: { qtyIn: true, qtyOut: true, valueChange: true } }),
    tx.inventoryLot.findFirst({ where: { organizationId, itemId, OR: [
      { qtyBalance: { not: 0 } }, { carryingValue: { not: 0 } },
    ] }, select: { id: true } }),
  ]);
  const hasOpenPool = pools.some(pool => {
    const incoming = pool._sum.qtyIn;
    const outgoing = pool._sum.qtyOut;
    const value = pool._sum.valueChange;
    return (incoming && !incoming.minus(outgoing ?? 0).isZero()) || (value && !value.isZero());
  });
  if (nonzeroLot || hasOpenPool) {
    throw new ApiError('Cannot change the inventory account while this item has stock or inventory value. Clear and reconcile the stock first. This account change does not yet accept an approved transfer.', 409);
  }
}
