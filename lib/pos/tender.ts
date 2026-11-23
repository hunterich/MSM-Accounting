import { roundMoneyDecimal } from '../money-decimal';

export interface CashTenderResult {
  ok: boolean;
  change: number;
  reason?: string;
}

/** Validate a single cash tender against the sale total and compute change. */
export function validateCashTender(total: number, cashGiven: number): CashTenderResult {
  if (total <= 0) {
    return { ok: false, change: 0, reason: 'Sale total must be greater than zero' };
  }
  if (!Number.isFinite(cashGiven)) {
    return { ok: false, change: 0, reason: 'Invalid cash amount' };
  }
  const cash = roundMoneyDecimal(cashGiven);
  if (cash.lt(total)) {
    return { ok: false, change: 0, reason: 'Insufficient cash tendered' };
  }
  return { ok: true, change: cash.minus(total).toNumber() };
}
