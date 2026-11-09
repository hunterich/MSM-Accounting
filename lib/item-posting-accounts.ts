import { ApiError } from './errors';

type Account = { id: string; type: string; isActive: boolean; isPostable: boolean };

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
