import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { lockInventoryItems } from './inventory-costing';

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
