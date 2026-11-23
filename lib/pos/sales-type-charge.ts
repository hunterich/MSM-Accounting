import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { MoneyDecimal, roundMoneyDecimal } from '../money-decimal';

/**
 * Service charge for a sales type. chargeAmt = pct% of the (tax-inclusive) goods total.
 * When taxable, taxAddon is the PPN already embedded in chargeAmt (split out for the invoice's
 * taxAmount, exactly how invoice-send-posting expects a tax-inclusive charge). Non-taxable → 0.
 */
export function computeServiceCharge({ goodsTotal, pct, rate }: { goodsTotal: Decimal.Value; pct: Decimal.Value; rate: number }) {
  const chargeAmt = roundMoneyDecimal(new MoneyDecimal(goodsTotal).mul(MoneyDecimal.max(pct, 0)).div(100));
  const net = roundMoneyDecimal(chargeAmt.div(new MoneyDecimal(rate).div(100).plus(1)));
  const taxAddon = chargeAmt.minus(net);
  return { chargeAmt, taxAddon };
}
