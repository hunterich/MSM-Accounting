export interface SaleLineInput {
  itemId: string;
  description: string;
  quantity: number;
  price: number;      // tax-inclusive unit price
  discountPct: number; // 0..100
}

export interface SaleTotals {
  subtotal: number;    // total net of embedded tax
  taxAmount: number;   // embedded PPN
  totalAmount: number; // what the customer pays (tax-inclusive)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Compute tax-inclusive totals for a POS cart. */
export function computeSaleTotals(lines: SaleLineInput[], taxRatePct: number): SaleTotals {
  const totalAmount = round2(
    lines.reduce((sum, l) => sum + l.quantity * l.price * (1 - (l.discountPct || 0) / 100), 0),
  );
  if (totalAmount <= 0) {
    return { subtotal: 0, taxAmount: 0, totalAmount: 0 };
  }
  const divisor = 1 + taxRatePct / 100;
  const subtotal = round2(totalAmount / divisor);
  const taxAmount = round2(totalAmount - subtotal);
  return { subtotal, taxAmount, totalAmount };
}
