import { computeSaleTotals, type SaleLineInput } from '@/lib/pos/pricing';

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  sellingPrice: number;
}

export interface CartLine {
  itemId: string;
  name: string;
  price: number;      // tax-inclusive unit price
  quantity: number;
  discountPct: number;
}

export interface Cart {
  lines: CartLine[];
}

export function emptyCart(): Cart {
  return { lines: [] };
}

export function addItem(cart: Cart, item: CatalogItem): Cart {
  const existing = cart.lines.find((l) => l.itemId === item.id);
  if (existing) {
    return { lines: cart.lines.map((l) => (l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l)) };
  }
  return {
    lines: [...cart.lines, { itemId: item.id, name: item.name, price: item.sellingPrice, quantity: 1, discountPct: 0 }],
  };
}

export function setQty(cart: Cart, itemId: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, itemId);
  return { lines: cart.lines.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)) };
}

export function setDiscount(cart: Cart, itemId: string, discountPct: number): Cart {
  const clamped = Math.max(0, Math.min(100, discountPct));
  return { lines: cart.lines.map((l) => (l.itemId === itemId ? { ...l, discountPct: clamped } : l)) };
}

export function removeLine(cart: Cart, itemId: string): Cart {
  return { lines: cart.lines.filter((l) => l.itemId !== itemId) };
}

/** Sale lines in the server's input shape (reused for both display totals and the POST body). */
export function toSaleLines(cart: Cart): SaleLineInput[] {
  return cart.lines.map((l) => ({
    itemId: l.itemId,
    description: l.name,
    quantity: l.quantity,
    price: l.price,
    discountPct: l.discountPct,
  }));
}

export function cartTotal(cart: Cart): number {
  return computeSaleTotals(toSaleLines(cart), 11).totalAmount;
}
