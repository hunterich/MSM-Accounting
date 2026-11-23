import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { MoneyDecimal, roundMoneyDecimal, allocateRoundedAmount } from './money-decimal';

type Decimal = Prisma.Decimal;
type InvoiceLine = { id: string; quantity: Decimal; lineSubtotal: Decimal; taxable: boolean | null };
type Invoice = {
  lines: InvoiceLine[];
  charges: Array<{ amount: Decimal; taxRate: Decimal }>;
  subtotal: Decimal;
  discountAmount: Decimal;
  taxEnabled: boolean;
  taxInclusive: boolean;
  taxRate: Decimal;
  taxAmount: Decimal;
  postingTracked: boolean;
};
type PriorLine = {
  sourceId: string;
  qtyReturn: Decimal;
  lineTotal: Decimal;
  taxAmount: Decimal | null;
  salesReturnId: string;
  salesReturn: { taxAmount: Decimal; taxIncluded: boolean; applyTax: boolean };
};

const zero = new MoneyDecimal(0);

function originalLineAmounts(invoice: Invoice) {
  const { subtotal, discountAmount, taxEnabled, taxInclusive, taxRate, lines } = invoice;
  if (taxRate.lt(0) || invoice.taxAmount.lt(0) || discountAmount.lt(0) || discountAmount.gt(subtotal) ||
      lines.some(line => line.lineSubtotal.lt(0))) {
    throw new ApiError('Invalid original invoice amounts. Review the invoice before valuing a return.', 422);
  }
  const taxable = lines.filter(line => line.taxable !== false);
  const exempt = lines.filter(line => line.taxable === false);
  const taxableSubtotal = taxable.reduce((sum, line) => sum.plus(line.lineSubtotal), zero);
  if (discountAmount.gt(0) && !lines.reduce((sum, line) => sum.plus(line.lineSubtotal), zero).eq(subtotal)) {
    throw new ApiError('The original invoice lines and discount base differ. Review the invoice before valuing a return.', 422);
  }
  const taxableDiscount = subtotal.isZero() ? zero : roundMoneyDecimal(discountAmount.mul(taxableSubtotal).div(subtotal));

  const taxableNet = allocateRoundedAmount(taxableDiscount, taxable.map(line => line.lineSubtotal))
    .map((discount, index) => taxable[index].lineSubtotal.minus(discount));
  const exemptNet = allocateRoundedAmount(discountAmount.minus(taxableDiscount), exempt.map(line => line.lineSubtotal))
    .map((discount, index) => exempt[index].lineSubtotal.minus(discount));
  const taxBase = taxableNet.reduce((sum, amount) => sum.plus(amount), zero);
  const rate = new MoneyDecimal(taxRate).div(100);
  const chargeBase = invoice.charges.reduce((sum, charge) => charge.taxRate.gt(0) ? sum.plus(charge.amount) : sum, zero);
  const invoiceTaxBase = taxBase.plus(chargeBase);
  // Use recorded PPN for posted invoices. Allocate its merchandise share,
  // since additional charges stay on the invoice when goods are returned.
  const invoiceTax = invoice.postingTracked || invoice.taxAmount.gt(0)
    ? invoice.taxAmount
    : roundMoneyDecimal(invoiceTaxBase.mul(rate).div(taxInclusive ? rate.plus(1) : 1));
  const totalTax = taxEnabled && invoiceTaxBase.gt(0) ? roundMoneyDecimal(invoiceTax.mul(taxBase).div(invoiceTaxBase)) : zero;
  if (taxInclusive && totalTax.gt(taxBase)) {
    throw new ApiError('The original invoice PPN exceeds its taxable amounts. Review the invoice before valuing a return.', 422);
  }
  const taxes = allocateRoundedAmount(totalTax, taxableNet);
  const result = new Map<string, { net: Decimal; tax: Decimal }>();
  taxable.forEach((line, index) => result.set(line.id, { net: taxInclusive ? taxableNet[index].minus(taxes[index]) : taxableNet[index], tax: taxes[index] }));
  exempt.forEach((line, index) => result.set(line.id, { net: exemptNet[index], tax: zero }));
  return result;
}

function alreadyReturned(prior: PriorLine[]) {
  const byReturn = new Map<string, PriorLine[]>();
  for (const line of prior) {
    const lines = byReturn.get(line.salesReturnId) ?? [];
    lines.push(line);
    byReturn.set(line.salesReturnId, lines);
  }
  const used = new Map<string, { qty: Decimal; net: Decimal; tax: Decimal }>();
  for (const lines of byReturn.values()) {
    const header = lines[0].salesReturn;
    // Older returns have only document-level PPN. Carry forward the recorded
    // total, allocated over their saved line amounts.
    const legacyTaxes = lines.some(line => line.taxAmount == null)
      ? allocateRoundedAmount(header.applyTax ? header.taxAmount : zero, lines.map(line => line.lineTotal))
      : [];
    for (const [index, line] of lines.entries()) {
      const tax = line.taxAmount ?? legacyTaxes[index];
      const net = header.taxIncluded ? line.lineTotal.minus(tax) : line.lineTotal;
      const before = used.get(line.sourceId) ?? { qty: zero, net: zero, tax: zero };
      used.set(line.sourceId, { qty: before.qty.plus(line.qtyReturn), net: before.net.plus(net), tax: before.tax.plus(tax) });
    }
  }
  return used;
}

export function calculateSalesReturnAmounts(
  invoice: Invoice,
  lines: Array<{ source: InvoiceLine; qtyReturn: Decimal }>,
  prior: PriorLine[],
) {
  const original = originalLineAmounts(invoice);
  const used = alreadyReturned(prior);
  let subtotal = zero;
  let taxAmount = zero;
  const values = lines.map(({ source, qtyReturn }) => {
    if (qtyReturn.isZero()) return { lineTotal: zero, taxAmount: zero };
    const full = original.get(source.id)!;
    const before = used.get(source.id) ?? { qty: zero, net: zero, tax: zero };
    const qty = before.qty.plus(qtyReturn);
    if (before.net.lt(0) || before.tax.lt(0) || before.net.gt(full.net) || before.tax.gt(full.tax)) {
      throw new ApiError('Earlier returns exceed the original invoice value. Review the recorded returns before continuing.', 422);
    }
    const net = MoneyDecimal.max(0, roundMoneyDecimal(full.net.mul(qty).div(source.quantity)).minus(before.net));
    const tax = MoneyDecimal.max(0, roundMoneyDecimal(full.tax.mul(qty).div(source.quantity)).minus(before.tax));
    used.set(source.id, { qty, net: before.net.plus(net), tax: before.tax.plus(tax) });
    const lineTotal = invoice.taxInclusive ? net.plus(tax) : net;
    subtotal = subtotal.plus(lineTotal);
    taxAmount = taxAmount.plus(tax);
    return { lineTotal, taxAmount: tax };
  });
  return { lines: values, subtotal, taxAmount, totalAmount: invoice.taxInclusive ? subtotal : subtotal.plus(taxAmount) };
}
