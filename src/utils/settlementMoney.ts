import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { MoneyDecimal, roundMoneyDecimal } from '@/lib/money-decimal';
import type { SettlementFeeKey } from './settlementMapping';

export type SettlementCharges<T> = Partial<Record<SettlementFeeKey, T>>;

// Each canonical charge becomes one journal line, even when several source columns contribute to it.
export function settlementPostingCharges(charges: SettlementCharges<Decimal>): SettlementCharges<string> {
  const postingCharges: SettlementCharges<string> = {};
  for (const key of Object.keys(charges) as SettlementFeeKey[]) {
    const amount = roundMoneyDecimal(charges[key] ?? 0);
    if (!amount.isZero()) postingCharges[key] = amount.toFixed(2);
  }
  return postingCharges;
}

export function totalSettlementPayout(orders: Array<{ netReleased: string }>): string {
  return orders.reduce((sum, order) => sum.plus(order.netReleased), new MoneyDecimal(0)).toFixed(2);
}
