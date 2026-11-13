import { ApiError } from './errors';

export type AdjustmentMovement = { inventoryAccountId: string; accountId?: string | null; value: number };

/** Values come from inventory costing, expressed as signed inventory changes. */
export function allocateAdjustmentOffsets(movements: AdjustmentMovement[], postsLineAccounts: boolean, varianceAccountId: string) {
  if (!postsLineAccounts && !varianceAccountId && movements.reduce((sum, movement) => sum + Math.round(movement.value * 100), 0) === 0) return [];
  const centsByAccount = new Map<string, number>();
  for (const movement of movements) {
    const cents = Math.round(movement.value * 100);
    if (!cents) continue;
    const accountId = (postsLineAccounts && movement.accountId) || varianceAccountId;
    if (!accountId) throw new ApiError('No stock variance account is configured.', 422);
    if (accountId === movement.inventoryAccountId) throw new ApiError('Stock adjustment offset account cannot equal the inventory posting account.', 422);
    centsByAccount.set(accountId, (centsByAccount.get(accountId) ?? 0) + cents);
  }
  return [...centsByAccount].filter(([, cents]) => cents !== 0).map(([accountId, cents]) => ({ accountId, value: cents / 100 }));
}
