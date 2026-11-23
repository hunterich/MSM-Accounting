import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';

const ZERO = new MoneyDecimal(0);

export function normalizeBillLineAmounts(line: { quantity: unknown; price: unknown; discountPct?: unknown; lineTotal?: unknown }) {
  const quantity = new MoneyDecimal(String(line.quantity ?? 0).trim() || '0').toDecimalPlaces(4);
  const price = roundMoneyDecimal(String(line.price ?? 0).trim() || '0');
  const discountPct = roundMoneyDecimal(String(line.discountPct ?? 0).trim() || '0');
  const lineTotal = line.lineTotal == null
    ? roundMoneyDecimal(quantity.mul(price).mul(new MoneyDecimal(1).minus(discountPct.div(100))))
    : roundMoneyDecimal(String(line.lineTotal));
  return { quantity, price, discountPct, lineTotal };
}

/** Use the bill's PPN rate for each taxable item or charge. For inclusive
 * prices the net is rounded first and tax is the remainder of the gross. */
export function splitBillLineTax(gross: Decimal, rate: Decimal, inclusive: boolean) {
  if (rate.isZero()) return { net: gross, tax: ZERO };
  if (inclusive) {
    const net = roundMoneyDecimal(gross.div(rate.plus(1)));
    return { net, tax: gross.minus(net) };
  }
  return { net: gross, tax: roundMoneyDecimal(gross.mul(rate)) };
}

export function calculateBillAmounts(input: {
  lines: readonly { lineTotal: unknown; taxable?: boolean | null; poReceiptTaxAmount?: unknown }[];
  charges?: readonly { amount: unknown; taxRate?: unknown }[];
  taxable?: boolean;
  taxInclusive?: boolean;
  taxRate?: unknown;
  withholdingRate?: unknown;
}) {
  const rate = input.taxable ? roundMoneyDecimal(String(input.taxRate ?? 0)).div(100) : ZERO;
  function split(amount: unknown, taxable: boolean) {
    const gross = roundMoneyDecimal(String(amount ?? 0));
    return { gross, taxable, ...splitBillLineTax(gross, taxable ? rate : ZERO, Boolean(input.taxInclusive)) };
  }

  const lines = input.lines.map(line => {
    const part = split(line.lineTotal, line.taxable !== false);
    if (line.poReceiptTaxAmount == null) return part;
    const tax = roundMoneyDecimal(String(line.poReceiptTaxAmount));
    return { ...part, tax, net: input.taxInclusive ? part.gross.minus(tax) : part.gross };
  });
  const charges = (input.charges ?? []).map(charge => split(charge.amount, roundMoneyDecimal(String(charge.taxRate ?? 0)).gt(0)));
  const subtotal = lines.reduce((sum, line) => sum.plus(line.gross), ZERO);
  const goodsNet = lines.reduce((sum, line) => sum.plus(line.net), ZERO);
  const chargesNet = charges.reduce((sum, charge) => sum.plus(charge.net), ZERO);
  const chargesTotal = charges.reduce((sum, charge) => sum.plus(charge.gross), ZERO);
  const taxableBase = input.taxable
    ? [...lines, ...charges].reduce((sum, part) => part.taxable ? sum.plus(part.net) : sum, ZERO)
    : ZERO;
  const taxAmount = [...lines, ...charges].reduce((sum, part) => sum.plus(part.tax), ZERO);
  const withholdingAmount = roundMoneyDecimal(goodsNet.mul(roundMoneyDecimal(String(input.withholdingRate ?? 0)).div(100)));
  return {
    lines,
    charges,
    subtotal,
    goodsNet,
    chargesTotal,
    taxableBase,
    taxAmount,
    withholdingAmount,
    totalAmount: goodsNet.plus(chargesNet).plus(taxAmount).minus(withholdingAmount),
  };
}
