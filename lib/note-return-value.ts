import { Prisma } from '@prisma/client';
import { ApiError } from './errors';

const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
const money = (value: Prisma.Decimal.Value) => new Decimal(value).toDecimalPlaces(2);

function gross(base: Prisma.Decimal, enabled: boolean, inclusive: boolean, rate: Prisma.Decimal) {
  return money(enabled && !inclusive ? base.plus(money(base.mul(rate).div(100))) : base);
}

/** Derive the credit basis from the original sale, retaining full precision until
 * the document subtotal is rounded. The last line absorbs any cent remainder. */
export function salesReturnAmounts(invoice: {
  id: string; subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal;
  taxEnabled: boolean; taxInclusive: boolean; taxRate: Prisma.Decimal;
}, lines: Array<{ qtyReturn: Prisma.Decimal.Value; source: { invoiceId: string; quantity: Prisma.Decimal; lineSubtotal: Prisma.Decimal } | null }>) {
  if (invoice.taxRate.lt(0)) throw new ApiError('Invalid original invoice tax rate; finance review is required', 422);
  const portions = lines.map(({ qtyReturn, source }) => {
    const qty = new Decimal(qtyReturn);
    if (!source || source.invoiceId !== invoice.id || source.quantity.lte(0) || source.lineSubtotal.lt(0) || !qty.isFinite() || qty.lt(0)) {
      throw new ApiError('Return valuation requires valid original invoice lines; finance review is required', 422);
    }
    if (invoice.discountAmount.lt(0) || (invoice.discountAmount.gt(0) &&
      (invoice.subtotal.lte(0) || invoice.discountAmount.gt(invoice.subtotal)))) {
      throw new ApiError('Invalid original invoice discount; finance review is required', 422);
    }
    let portion = new Decimal(source.lineSubtotal).mul(qty).div(source.quantity);
    if (invoice.discountAmount.gt(0)) portion = portion.mul(new Decimal(1).minus(new Decimal(invoice.discountAmount).div(invoice.subtotal)));
    return portion;
  });
  const subtotal = money(portions.reduce((sum, portion) => sum.plus(portion), new Decimal(0)));
  let cumulative = new Decimal(0), assigned = new Decimal(0);
  const lineTotals = portions.map(portion => {
    cumulative = cumulative.plus(portion);
    const rounded = money(cumulative), amount = rounded.minus(assigned);
    assigned = rounded;
    return amount;
  });
  const total = gross(subtotal, invoice.taxEnabled, invoice.taxInclusive, invoice.taxRate);
  const taxAmount = !invoice.taxEnabled ? money(0) : invoice.taxInclusive
    ? money(subtotal.minus(subtotal.div(new Decimal(1).plus(new Decimal(invoice.taxRate).div(100)))))
    : total.minus(subtotal);
  return { subtotal, taxAmount, total, lineTotals };
}

/** Validate the financial basis independently of client-supplied return totals.
 * No inventory cost, journal, or settlement balance participates in this value.
 * Historical inconsistent totals require finance review, never an automatic rewrite.
 */
export async function linkedReturnValue(
  tx: Prisma.TransactionClient, kind: 'credit' | 'debit', organizationId: string, returnId: string,
): Promise<Prisma.Decimal> {
  let expected: Prisma.Decimal;
  let recorded: Prisma.Decimal;
  if (kind === 'credit') {
    const ret = await tx.salesReturn.findFirstOrThrow({ where: { id: returnId, organizationId },
      include: { lines: { include: { sourceInvoiceLine: true } }, invoice: true } });
    const invoice = ret.invoice;
    expected = salesReturnAmounts(invoice, ret.lines.map(line => ({ qtyReturn: line.qtyReturn, source: line.sourceInvoiceLine }))).total;
    recorded = ret.totalAmount;
  } else {
    const ret = await tx.purchaseReturn.findFirstOrThrow({ where: { id: returnId, organizationId }, include: { lines: true } });
    // Purchase-return prices are the agreed supplier return prices, which may
    // differ from the original bill and from inventory carrying cost.
    let base = new Decimal(0);
    for (const line of ret.lines) {
      if (line.qtyReturn.lt(0) || line.price.lt(0)) throw new ApiError('Invalid supplier return valuation', 422);
      base = base.plus(money(new Decimal(line.qtyReturn).mul(line.price)));
    }
    expected = gross(money(base), ret.applyTax, ret.taxIncluded, ret.taxRate);
    recorded = ret.totalAmount;
  }
  if (!expected.isFinite() || expected.lt(0) || !expected.eq(recorded)) {
    throw new ApiError(`Recorded return total does not match its approved valuation basis (expected ${expected.toFixed(2)}); finance review is required`, 422);
  }
  return expected;
}
