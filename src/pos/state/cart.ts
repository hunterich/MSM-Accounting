import { computeSaleTotals, type SaleLineInput, type SelectedModifier } from '@/lib/pos/pricing';

/** A selectable option within a modifier group (e.g. "Large", "Extra shot"). */
export interface ModifierOptionView {
  id: string;
  name: string;
  priceDelta: number;      // tax-inclusive, may be 0
  itemId?: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** A group of modifier options attached to a catalog item (e.g. "Size", "Add-ons"). */
export interface ModifierGroupView {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTI';
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
  options: ModifierOptionView[];
}

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  sellingPrice: number;
  earliestExpiry?: string | null;
  modifierGroups?: ModifierGroupView[];
}

export interface CartLine {
  key: string;         // itemId + modifier hash — unique identity of the line
  itemId: string;
  name: string;
  price: number;       // tax-inclusive unit price (base + Σ priceDelta)
  quantity: number;
  discountPct: number;
  modifiers: SelectedModifier[];
  modifierNote?: string;   // optional free-text note shown under the line (display only)
  earliestExpiry?: string | null;
}

export interface Cart {
  lines: CartLine[];
}

export function emptyCart(): Cart {
  return { lines: [] };
}

/** Builds the stable identity key for a cart line: itemId plus its sorted selected option ids. */
export function lineKey(itemId: string, mods: SelectedModifier[]): string {
  const ids = mods.map((m) => m.optionId).sort().join(',');
  return ids ? `${itemId}#${ids}` : itemId;
}

export function addItem(cart: Cart, item: CatalogItem): Cart {
  const existing = cart.lines.find((l) => l.key === item.id);
  if (existing) {
    return { lines: cart.lines.map((l) => (l.key === item.id ? { ...l, quantity: l.quantity + 1 } : l)) };
  }
  return {
    lines: [
      ...cart.lines,
      {
        key: item.id,
        itemId: item.id,
        name: item.name,
        price: item.sellingPrice,
        quantity: 1,
        discountPct: 0,
        modifiers: [],
        earliestExpiry: item.earliestExpiry ?? null,
      },
    ],
  };
}

/** Adds a line configured with modifiers. Identical configurations (same item + same option set) merge; different configurations stay separate lines. */
export function addConfiguredItem(cart: Cart, item: CatalogItem, mods: SelectedModifier[]): Cart {
  const key = lineKey(item.id, mods);
  const existing = cart.lines.find((l) => l.key === key);
  if (existing) {
    return { lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)) };
  }
  const price = item.sellingPrice + mods.reduce((s, m) => s + m.priceDelta, 0);
  return {
    lines: [
      ...cart.lines,
      {
        key,
        itemId: item.id,
        name: item.name,
        price,
        quantity: 1,
        discountPct: 0,
        modifiers: mods,
        earliestExpiry: item.earliestExpiry ?? null,
      },
    ],
  };
}

/** True when every required modifier group has at least one selected option among mods. */
export function requiredGroupsSatisfied(groups: { id: string; isRequired: boolean }[], mods: SelectedModifier[]): boolean {
  const chosen = new Set(mods.map((m) => m.groupId));
  return groups.filter((g) => g.isRequired).every((g) => chosen.has(g.id));
}

export function setQty(cart: Cart, key: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, key);
  return { lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) };
}

export function setDiscount(cart: Cart, key: string, discountPct: number): Cart {
  const clamped = Math.max(0, Math.min(100, discountPct));
  return { lines: cart.lines.map((l) => (l.key === key ? { ...l, discountPct: clamped } : l)) };
}

export function removeLine(cart: Cart, key: string): Cart {
  return { lines: cart.lines.filter((l) => l.key !== key) };
}

/** Sale lines in the server's input shape (reused for both display totals and the POST body). */
export function toSaleLines(cart: Cart): SaleLineInput[] {
  return cart.lines.map((l) => ({
    itemId: l.itemId,
    description: l.name,
    quantity: l.quantity,
    price: l.price,
    discountPct: l.discountPct,
    modifiers: l.modifiers,
  }));
}

export function cartTotal(cart: Cart): number {
  return computeSaleTotals(toSaleLines(cart), 11).totalAmount;
}
