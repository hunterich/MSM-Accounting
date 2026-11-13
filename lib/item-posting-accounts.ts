import { ApiError } from './errors';
import { toNumber } from './money';

type Account = { id: string; type: string; isActive: boolean; isPostable: boolean };

/**
 * Lots that were booked with value. Free goods and zero-cost stock never reach
 * an inventory GL account, so a missing account on them is not lost history.
 */
export function lotsWithBookValue<T extends { qtyIn: unknown; unitCost: unknown; initialValue?: unknown }>(lots: readonly T[]): T[] {
  return lots.filter(lot => (lot.initialValue != null ? toNumber(lot.initialValue) : toNumber(lot.qtyIn) * toNumber(lot.unitCost)) !== 0);
}

/** Explicit item settings must not silently fall back when invalid. */
export function itemPostingAccount(
  accounts: readonly Account[], configuredId: string | null | undefined,
  fallbackId: string | null | undefined, type: 'ASSET' | 'REVENUE' | 'EXPENSE', label: string,
): string | null {
  if (!configuredId) return fallbackId || null;
  const account = accounts.find(a => a.id === configuredId);
  if (!account || !account.isActive || !account.isPostable || account.type.toUpperCase() !== type) {
    throw new ApiError(`The ${label} item account must be an active, postable ${type.toLowerCase()} account in this company.`, 422);
  }
  return account.id;
}
