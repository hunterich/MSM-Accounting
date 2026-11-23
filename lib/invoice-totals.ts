import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';

type InvoiceLine = {
  itemId?: string | null;
  code?: string | null;
  description: string;
  quantity: Decimal.Value;
  unit?: string | null;
  price: Decimal.Value;
  discountPct?: Decimal.Value;
  taxable?: boolean | null;
  /** Only for callers with a trusted stored or source line amount. */
  lineSubtotal?: Decimal.Value;
};

type InvoiceCharge = { label: string; accountId?: string | null; amount: Decimal.Value; taxRate?: Decimal.Value };
type InvoiceTax = { enabled?: boolean; inclusive?: boolean; rate?: Decimal.Value };

const ZERO = new MoneyDecimal(0);

export function calculateInvoiceLineAmounts(line: Pick<InvoiceLine, 'quantity' | 'price' | 'discountPct' | 'lineSubtotal'>) {
  const quantity = new MoneyDecimal(line.quantity).toDecimalPlaces(4);
  const price = roundMoneyDecimal(line.price);
  const discountPct = roundMoneyDecimal(line.discountPct ?? 0);
  const gross = roundMoneyDecimal(quantity.mul(price));
  const lineDiscount = roundMoneyDecimal(gross.mul(discountPct).div(100));
  const lineSubtotal = line.lineSubtotal == null ? gross.minus(lineDiscount) : roundMoneyDecimal(line.lineSubtotal);
  return { quantity, price, discountPct, lineSubtotal };
}

export function calculateInvoiceTotals(
  payload: {
    lines: readonly InvoiceLine[];
    charges?: readonly InvoiceCharge[];
    discountPct?: Decimal.Value;
    tax?: InvoiceTax;
  },
  defaults: { taxEnabled: boolean; taxDefaultRate: Decimal.Value; taxInclusiveByDefault: boolean },
) {
  const lines = payload.lines.map((line, index) => ({
    lineNo: index + 1, itemId: line.itemId || null, code: line.code || null,
    description: line.description, unit: line.unit || 'PCS', taxable: line.taxable ?? null,
    ...calculateInvoiceLineAmounts(line),
  }));
  const subtotal = lines.reduce((sum, line) => sum.plus(line.lineSubtotal), ZERO);
  const discountPct = roundMoneyDecimal(payload.discountPct ?? 0);
  const discountAmount = roundMoneyDecimal(subtotal.mul(discountPct).div(100));
  const discountedSubtotal = subtotal.minus(discountAmount);
  const taxableSubtotal = lines.reduce((sum, line) => line.taxable === false ? sum : sum.plus(line.lineSubtotal), ZERO);
  // For a mixed invoice, only the taxable share of a document discount reduces the PPN base.
  const taxableDiscount = subtotal.isZero() ? ZERO : roundMoneyDecimal(discountAmount.mul(taxableSubtotal).div(subtotal));

  // A charge with a positive tax rate joins the invoice PPN base.
  const charges = (payload.charges ?? []).map((charge, index) => ({
    lineNo: index + 1, label: charge.label, accountId: charge.accountId || null,
    amount: roundMoneyDecimal(charge.amount), taxRate: roundMoneyDecimal(charge.taxRate ?? 0),
  }));
  const chargesTotal = charges.reduce((sum, charge) => sum.plus(charge.amount), ZERO);
  const taxableBase = charges.reduce((sum, charge) => charge.taxRate.gt(0) ? sum.plus(charge.amount) : sum, taxableSubtotal.minus(taxableDiscount));
  const taxEnabled = payload.tax?.enabled ?? defaults.taxEnabled;
  const taxInclusive = payload.tax?.inclusive ?? defaults.taxInclusiveByDefault;
  const taxRate = roundMoneyDecimal(payload.tax?.rate ?? defaults.taxDefaultRate);
  const rate = taxRate.div(100);

  // Sales invoices round PPN once on the document tax base.
  let taxAmount = ZERO;
  if (taxEnabled && rate.gt(0)) {
    taxAmount = roundMoneyDecimal(taxInclusive ? taxableBase.mul(rate).div(rate.plus(1)) : taxableBase.mul(rate));
  }
  const totalAmount = discountedSubtotal.plus(chargesTotal).plus(taxInclusive ? ZERO : taxAmount);

  return {
    lines, charges, subtotal, chargesTotal, taxableBase,
    discountPct, discountAmount, taxEnabled, taxInclusive, taxRate, taxAmount, totalAmount,
  };
}
