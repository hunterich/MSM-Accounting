export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number; // tax-inclusive, may be 0
  itemId?: string | null;
}

export interface SaleLineInput {
  itemId: string;
  description: string;
  quantity: number;
  price: number;      // tax-inclusive unit price
  discountPct: number; // 0..100
  /** Staff member (Employee id) credited for this line. Optional: the pharmacy
   *  sends none and the server defaults it to the cashier's staff record. */
  performedById?: string | null;
  modifiers?: SelectedModifier[]; // NEW — selected options for this line
}

export interface SaleTotals {
  subtotal: number;    // total net of embedded tax
  taxAmount: number;   // embedded PPN
  totalAmount: number; // what the customer pays (tax-inclusive)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Line shape needed to price a cart. Both `SaleLineInput` (base cart lines)
 *  and the materialized/flattened invoice lines satisfy it. */
export type PriceableLine = { quantity: number; price: number; discountPct?: number };

/** Compute tax-inclusive totals for a POS cart. */
export function computeSaleTotals(lines: ReadonlyArray<PriceableLine>, taxRatePct: number): SaleTotals {
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
