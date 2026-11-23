import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { MoneyDecimal as Decimal, roundMoneyDecimal as money } from './money-decimal';

export function assertReturnPreview(
  amounts: { totalAmount: Prisma.Decimal; taxAmount: Prisma.Decimal },
  expected: { totalAmount: Prisma.Decimal.Value; taxAmount: Prisma.Decimal.Value } | undefined,
) {
  if (expected && (!amounts.totalAmount.eq(expected.totalAmount) || !amounts.taxAmount.eq(expected.taxAmount))) {
    throw new ApiError('Return amounts changed since the preview. Review the updated amounts and try again.', 409);
  }
}

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

function savedReturnBasis(ret: {
  lines: Array<{ lineTotal: Prisma.Decimal; taxAmount: Prisma.Decimal | null }>;
  subtotal: Prisma.Decimal; taxAmount: Prisma.Decimal; applyTax: boolean; taxIncluded: boolean;
}) {
  if (!ret.lines.length || ret.lines.some(line => line.taxAmount == null)) return null;
  let subtotal = new Decimal(0);
  let tax = new Decimal(0);
  for (const line of ret.lines) {
    if (line.lineTotal.lt(0) || line.taxAmount!.lt(0) || (ret.taxIncluded && line.taxAmount!.gt(line.lineTotal))) {
      throw new ApiError('Invalid saved return valuation. Finance review is required.', 422);
    }
    subtotal = subtotal.plus(line.lineTotal);
    tax = tax.plus(line.taxAmount!);
  }
  if (!subtotal.eq(ret.subtotal) || !tax.eq(ret.taxAmount) || (!ret.applyTax && !tax.isZero())) {
    throw new ApiError('Saved return lines and totals differ. Finance review is required.', 422);
  }
  return { total: ret.taxIncluded ? subtotal : subtotal.plus(tax), tax };
}

/** Validate the financial basis independently of client-supplied return totals.
 * No inventory cost, journal, or settlement balance participates in this value.
 * Historical inconsistent totals require finance review, never an automatic rewrite.
 */
export async function linkedReturnBasis(
  tx: Prisma.TransactionClient, kind: 'credit' | 'debit', organizationId: string, returnId: string,
) {
  let expected: Prisma.Decimal;
  let recorded: Prisma.Decimal;
  let tax: Prisma.Decimal | null = null;
  if (kind === 'credit') {
    const ret = await tx.salesReturn.findFirstOrThrow({ where: { id: returnId, organizationId },
      include: { lines: { include: { sourceInvoiceLine: true } }, invoice: true } });
    const invoice = ret.invoice;
    const basis = savedReturnBasis(ret);
    if (basis) {
      // Allocated cents belong to this return even if a different return is
      // later voided. Verify its saved basis without revaluing posted history.
      if (ret.lines.some(line => line.sourceInvoiceLine?.invoiceId !== invoice.id)) {
        throw new ApiError('Invalid saved return valuation. Finance review is required.', 422);
      }
      ({ total: expected, tax } = basis);
    } else {
      expected = salesReturnAmounts(invoice, ret.lines.map(line => ({ qtyReturn: line.qtyReturn, source: line.sourceInvoiceLine }))).total;
    }
    recorded = ret.totalAmount;
  } else {
    const ret = await tx.purchaseReturn.findFirstOrThrow({ where: { id: returnId, organizationId }, include: { lines: true } });
    if (ret.lines.some(line => line.qtyReturn.lt(0) || line.price.lt(0))) throw new ApiError('Invalid supplier return valuation', 422);
    const basis = savedReturnBasis(ret);
    if (basis) {
      ({ total: expected, tax } = basis);
    } else {
      // Historical returns used document-level PPN on the agreed prices.
      const base = ret.lines.reduce((sum, line) => sum.plus(money(new Decimal(line.qtyReturn).mul(line.price))), new Decimal(0));
      expected = gross(base, ret.applyTax, ret.taxIncluded, ret.taxRate);
    }
    recorded = ret.totalAmount;
  }
  if (!expected.isFinite() || expected.lt(0) || !expected.eq(recorded)) {
    throw new ApiError(`Recorded return total does not match its approved valuation basis (expected ${expected.toFixed(2)}); finance review is required`, 422);
  }
  return { total: expected, tax };
}

export async function linkedReturnValue(
  tx: Prisma.TransactionClient, kind: 'credit' | 'debit', organizationId: string, returnId: string,
): Promise<Prisma.Decimal> {
  return (await linkedReturnBasis(tx, kind, organizationId, returnId)).total;
}
