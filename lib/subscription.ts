/**
 * Subscription lifecycle utilities — pro-rata refunds, period calculation, trial dates.
 */

export interface ProRataResult {
  refundAmount: number;
  daysUsed: number;
  daysTotal: number;
}

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
  interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
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
    case 'YEARLY':
      end.setFullYear(end.getFullYear() + 1);
      break;
  }
  end.setDate(end.getDate() - 1);

  return { start, end };
}

export function calculateTrialEndDate(startDate: Date | string, trialDays: number): Date {
  const date = new Date(startDate);
  date.setDate(date.getDate() + trialDays);
  return date;
}
