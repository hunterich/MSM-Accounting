import { Prisma } from '@prisma/client';
import { ApiError } from './errors';

const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
const money = (value: Prisma.Decimal.Value) => new Decimal(value).toDecimalPlaces(2);

function gross(base: Prisma.Decimal, enabled: boolean, inclusive: boolean, rate: Prisma.Decimal) {
  return money(enabled && !inclusive ? base.plus(money(base.mul(rate).div(100))) : base);
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
    let base = new Decimal(0);
    for (const line of ret.lines) {
      const source = line.sourceInvoiceLine;
      if (!source || source.invoiceId !== ret.invoiceId || source.quantity.lte(0) || line.qtyReturn.lt(0)) {
        throw new ApiError('Return valuation requires valid original invoice lines; finance review is required', 422);
      }
      // Stored line subtotal already includes the line discount. Allocate the
      // invoice-level discount proportionally, excluding shipping/other charges.
      let portion = new Decimal(source.lineSubtotal).mul(line.qtyReturn).div(source.quantity);
      if (invoice.discountAmount.gt(0)) {
        if (invoice.subtotal.lte(0) || invoice.discountAmount.gt(invoice.subtotal)) {
          throw new ApiError('Invalid original invoice discount; finance review is required', 422);
        }
        portion = portion.mul(new Decimal(1).minus(new Decimal(invoice.discountAmount).div(invoice.subtotal)));
      }
      base = base.plus(portion);
    }
    expected = gross(money(base), invoice.taxEnabled, invoice.taxInclusive, invoice.taxRate);
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
