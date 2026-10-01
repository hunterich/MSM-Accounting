import { ApiError } from './errors';
import type { PurchasePolicy } from './organization/settings-config';

export interface AutoCloseOptions { autoCloseEnabled: boolean; autoCloseDays: number; }

export function resolveAutoCloseOptions(
  policy: PurchasePolicy, input: Partial<AutoCloseOptions>, existing?: AutoCloseOptions,
): AutoCloseOptions {
  const defaults = existing ?? policy;
  const next = {
    autoCloseEnabled: input.autoCloseEnabled ?? defaults.autoCloseEnabled,
    autoCloseDays: input.autoCloseDays ?? defaults.autoCloseDays,
  };
  if (!Number.isInteger(next.autoCloseDays) || next.autoCloseDays < 0 || next.autoCloseDays > 3650) {
    throw new ApiError('Auto-close days must be a whole number from 0 to 3650', 422);
  }
  if (!policy.allowAutoCloseOverride && (
    next.autoCloseEnabled !== defaults.autoCloseEnabled || next.autoCloseDays !== defaults.autoCloseDays
  )) {
    throw new ApiError('Changing auto-close on individual purchase orders is disabled in Purchase settings', 422);
  }
  return next;
}

export function autoCloseDate(expectedDate: Date | string | null | undefined, days: number): string | null {
  if (!expectedDate) return null;
  const date = new Date(expectedDate);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function purchaseOrderIsDue(po: AutoCloseOptions & { status: string; expectedDate?: Date | string | null }, today: string): boolean {
  const deadline = autoCloseDate(po.expectedDate, po.autoCloseDays);
  return po.autoCloseEnabled && ['APPROVED', 'PARTIAL_RECEIVED'].includes(po.status) && !!deadline && today >= deadline;
}
