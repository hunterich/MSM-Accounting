import { toNumber, asMoney } from '@/lib/money';

export function calculateInvoiceTotals(
  payload: any,
  orgDefaults: {
    taxEnabled: boolean;
    taxDefaultRate: unknown;
    taxInclusiveByDefault: boolean;
  },
) {
  const normalizedLines = payload.lines.map((line: any, index: number) => {
    const quantity = toNumber(line.quantity);
    const price = toNumber(line.price);
    const discountPct = toNumber(line.discountPct ?? 0);

    const gross = asMoney(quantity * price);
    const lineDiscount = asMoney(gross * (discountPct / 100));
    const lineSubtotal = asMoney(gross - lineDiscount);

    return {
      lineNo: index + 1,
      itemId: line.itemId || null,
      code: line.code || null,
      description: line.description,
      quantity,
      unit: line.unit || 'PCS',
      price,
      discountPct,
      lineSubtotal,
    };
  });

  const subtotal = asMoney(normalizedLines.reduce((sum: number, line: { lineSubtotal: number }) => sum + line.lineSubtotal, 0));
  const discountPct = toNumber(payload.discountPct ?? 0);
  const discountAmount = asMoney(subtotal * (discountPct / 100));
  const discountedSubtotal = asMoney(subtotal - discountAmount);

  // Additional costs (charges): each posts to its own account on SEND. A charge
  // with taxRate > 0 is taxable and joins the PPN base. Mirrors computeTotals.
  const normalizedCharges = (payload.charges ?? []).map((charge: any, index: number) => ({
    lineNo: index + 1,
    label: charge.label,
    accountId: charge.accountId || null,
    amount: asMoney(toNumber(charge.amount)),
    taxRate: toNumber(charge.taxRate ?? 0),
  }));
  const chargesTotal = asMoney(normalizedCharges.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0));
  const taxableCharges = asMoney(
    normalizedCharges.filter((c: { taxRate: number }) => c.taxRate > 0).reduce((sum: number, c: { amount: number }) => sum + c.amount, 0),
  );

  const taxEnabled = payload.tax?.enabled ?? orgDefaults.taxEnabled;
  const taxInclusive = payload.tax?.inclusive ?? orgDefaults.taxInclusiveByDefault;
  const taxRate = toNumber(payload.tax?.rate ?? orgDefaults.taxDefaultRate);
  const rate = taxRate / 100;

  let taxAmount = 0;
  let totalAmount = asMoney(discountedSubtotal + chargesTotal);

  if (taxEnabled && taxRate > 0) {
    const taxableBase = asMoney(discountedSubtotal + taxableCharges);
    if (taxInclusive) {
      taxAmount = asMoney(taxableBase - taxableBase / (1 + rate));
      totalAmount = asMoney(discountedSubtotal + chargesTotal); // tax already inside
    } else {
      taxAmount = asMoney(taxableBase * rate);
      totalAmount = asMoney(discountedSubtotal + chargesTotal + taxAmount);
    }
  }

  return {
    lines: normalizedLines,
    charges: normalizedCharges,
    subtotal,
    discountPct,
    discountAmount,
    taxEnabled,
    taxInclusive,
    taxRate,
    taxAmount,
    totalAmount,
  };
}
