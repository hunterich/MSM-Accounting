import { Decimal } from '@prisma/client/runtime/index-browser.js';

// Prisma's browser runtime lets the form and server use the same Decimal
// without bundling the generated database client into the browser.
export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function roundMoneyDecimal(value: Decimal.Value): Decimal {
  return new MoneyDecimal(value).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
}

/** Divide a rounded total by cumulative weight without losing a cent. */
export function allocateRoundedAmount(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  const zero = new MoneyDecimal(0);
  const weightTotal = weights.reduce((sum, weight) => sum.plus(weight), zero);
  if (weightTotal.isZero()) return weights.map(() => zero);
  let cumulative = zero;
  let assigned = zero;
  return weights.map(weight => {
    cumulative = cumulative.plus(weight);
    const target = roundMoneyDecimal(total.mul(cumulative).div(weightTotal));
    const amount = target.minus(assigned);
    assigned = target;
    return amount;
  });
}
