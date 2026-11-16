import type { Prisma } from '@prisma/client';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from './account-defaults';
import { ApiError } from './errors';

/** Reject inventory accounts as offsets on adjustments using line accounts. */
export async function assertStockAdjustmentOffsetsNotInventory(
  tx: Prisma.TransactionClient, orgId: string, accountIds: Array<string | null | undefined>,
  options: { adjustmentId?: string; movementAccountIds?: string[] } = {},
): Promise<void> {
  if (!accountIds.length) return;
  const [accounts, settings] = await Promise.all([
    tx.account.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true } }),
    loadOrgAccountDefaults(tx, orgId),
  ]);
  const inventory = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
  const fallback = resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') || resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  const ids = [...new Set(accountIds.map(id => id || fallback).filter(Boolean))];
  if (!ids.length) return;
  const [item, recorded] = await Promise.all([
    tx.item.findFirst({ where: { organizationId: orgId, inventoryAccountId: { in: ids } }, select: { id: true } }),
    options.adjustmentId ? tx.inventoryLedgerEntry.findFirst({ where: { organizationId: orgId, documentType: 'ADJUSTMENT', documentId: options.adjustmentId, inventoryPostingAccountId: { in: ids } }, select: { id: true } }) : null,
  ]);
  if (ids.includes(inventory) || item || recorded || options.movementAccountIds?.some(id => ids.includes(id))) {
    throw new ApiError('Inventory accounts cannot be used as stock adjustment offsets.', 422);
  }
}
