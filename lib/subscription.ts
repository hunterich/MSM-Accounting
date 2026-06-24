/**
 * Subscription lifecycle utilities — pro-rata refunds, period calculation, trial dates.
 */

export interface ProRataResult {
  refundAmount: number;
  daysUsed: number;
  daysTotal: number;
}

/** Mirrors the Prisma BillingInterval enum exactly. */
export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

export function calculateProRataRefund(
  plan: { price: number | string },
  subscription: { currentPeriodStart: Date | string; currentPeriodEnd: Date | string },
  cancelDate: Date | string,
): ProRataResult {
  const start = new Date(subscription.currentPeriodStart);
  const end = new Date(subscription.currentPeriodEnd);
  const cancel = new Date(cancelDate);

  const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const daysUsed = Math.max(0, Math.round((cancel.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, daysTotal - daysUsed);

  const price = Number(plan.price);
  const refundAmount = Math.round((price * daysRemaining / daysTotal) * 100) / 100;

  return { refundAmount, daysUsed, daysTotal };
}

export function calculateNextPeriod(
  currentPeriodEnd: Date | string,
  interval: BillingInterval,
): { start: Date; end: Date } {
  const start = new Date(currentPeriodEnd);
  start.setDate(start.getDate() + 1);

  const end = new Date(start);
  switch (interval) {
    case 'MONTHLY':
      end.setMonth(end.getMonth() + 1);
      break;
    case 'QUARTERLY':
      end.setMonth(end.getMonth() + 3);
      break;
    case 'SEMI_ANNUAL':
      end.setMonth(end.getMonth() + 6);
      break;
    case 'ANNUAL':
      end.setFullYear(end.getFullYear() + 1);
      break;
    default: {
      const _exhaustive: never = interval;
      throw new Error(`Unknown BillingInterval: ${_exhaustive}`);
    }
  }
  end.setDate(end.getDate() - 1);

  return { start, end };
}

export function calculateTrialEndDate(startDate: Date | string, trialDays: number): Date {
  const date = new Date(startDate);
  date.setDate(date.getDate() + trialDays);
  return date;
}
