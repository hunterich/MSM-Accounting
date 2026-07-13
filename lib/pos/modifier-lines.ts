import type { SaleLineInput } from './pricing';

export interface MaterializedLine {
  lineNo: number;
  parentLineNo: number | null;
  isModifier: boolean;
  itemId: string | null;
  description: string;
  quantity: number;
  price: number;
  discountPct: number;
  performedById: string | null;
  modifierNote: string | null;
}

/**
 * Flatten configured POS cart lines into SalesInvoiceLine-shaped rows:
 *  - one base line per input line (price = the item base, deltas NOT included);
 *  - one child line per selected option with priceDelta != 0 OR an itemId
 *    (parentLineNo → base lineNo, isModifier true, price = priceDelta, qty = base qty,
 *    discountPct inherited from the base line so a discounted modified line reconciles:
 *    q*base*(1-d) + Σ q*deltaᵢ*(1-d) = q*(base+Σdelta)*(1-d) = the cart's displayed price);
 *  - free options ($0, no item) become a comma-joined modifierNote on the base line.
 * Child-line itemId drives stock+COGS via the existing postInvoiceSend engine.
 * NOTE: caller must pass base line price WITHOUT deltas (strip them first).
 */
export function flattenSaleLines(lines: SaleLineInput[]): MaterializedLine[] {
  const out: MaterializedLine[] = [];
  let lineNo = 0;
  for (const l of lines) {
    const mods = l.modifiers ?? [];
    const freeNotes = mods.filter((m) => m.priceDelta === 0 && !m.itemId).map((m) => m.optionName);
    const baseNo = ++lineNo;
    out.push({
      lineNo: baseNo, parentLineNo: null, isModifier: false,
      itemId: l.itemId, description: l.description, quantity: l.quantity,
      price: l.price, discountPct: l.discountPct ?? 0,
      performedById: l.performedById ?? null,
      modifierNote: freeNotes.length ? freeNotes.join(', ') : null,
    });
    for (const m of mods) {
      if (m.priceDelta === 0 && !m.itemId) continue; // free → note only
      out.push({
        lineNo: ++lineNo, parentLineNo: baseNo, isModifier: true,
        itemId: m.itemId ?? null, description: m.optionName, quantity: l.quantity,
        price: m.priceDelta, discountPct: l.discountPct ?? 0, performedById: l.performedById ?? null,
        modifierNote: null,
      });
    }
  }
  return out;
}
