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

/** Calendar date (YYYY-MM-DD) `days` after `startDate`, or null without a valid start. */
export function autoCloseDate(startDate: Date | string | null | undefined, days: number): string | null {
  if (!startDate) return null;
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface AutoCloseSchedule extends AutoCloseOptions {
  /** PO date: a calendar date stored at UTC midnight. */
  date: Date | string | null | undefined;
  /** Moment of the latest reopen; converted to the company calendar day. */
  reopenedAt?: Date | string | null;
}

/**
 * Day the auto-close period starts: the reopen day when the PO was reopened,
 * otherwise the PO date. The expected delivery date plays no part.
 */
export function autoCloseStartDate(po: Pick<AutoCloseSchedule, 'date' | 'reopenedAt'>, timezone: string): string | null {
  if (po.reopenedAt) {
    const reopened = new Date(po.reopenedAt);
    if (!Number.isNaN(reopened.getTime())) return dateInTimezone(reopened, timezone);
  }
  if (!po.date) return null;
  const date = new Date(po.date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function autoCloseDeadline(po: AutoCloseSchedule, timezone: string): string | null {
  return autoCloseDate(autoCloseStartDate(po, timezone), po.autoCloseDays);
}

export function purchaseOrderIsDue(po: AutoCloseSchedule & { status: string }, today: string, timezone: string): boolean {
  const deadline = autoCloseDeadline(po, timezone);
  return po.autoCloseEnabled && ['APPROVED', 'PARTIAL_RECEIVED'].includes(po.status) && !!deadline && today >= deadline;
}
