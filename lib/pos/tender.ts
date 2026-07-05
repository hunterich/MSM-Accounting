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
  if (cashGiven < total) {
    return { ok: false, change: 0, reason: 'Insufficient cash tendered' };
  }
  return { ok: true, change: Math.round((cashGiven - total + Number.EPSILON) * 100) / 100 };
}
