const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ServiceChargeInput { goodsTotal: number; pct: number; taxable: boolean; rate: number; }
export interface ServiceChargeResult { chargeAmt: number; taxAddon: number; }

/**
 * Service charge for a sales type. chargeAmt = pct% of the (tax-inclusive) goods total.
 * When taxable, taxAddon is the PPN already embedded in chargeAmt (split out for the invoice's
 * taxAmount, exactly how invoice-send-posting expects a tax-inclusive charge). Non-taxable → 0.
 */
export function computeServiceCharge({ goodsTotal, pct, taxable, rate }: ServiceChargeInput): ServiceChargeResult {
  if (pct <= 0) return { chargeAmt: 0, taxAddon: 0 };
  const chargeAmt = round2(goodsTotal * pct / 100);
  const taxAddon = taxable && rate > 0 ? round2(chargeAmt - chargeAmt / (1 + rate / 100)) : 0;
  return { chargeAmt, taxAddon };
}
