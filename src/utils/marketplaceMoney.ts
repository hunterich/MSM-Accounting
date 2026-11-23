import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { MoneyDecimal } from '@/lib/money-decimal';

export function readMarketplaceDecimal(
  cell: unknown,
  label: string,
  indonesianGrouping = false,
): Decimal | null {
  if (cell == null || (typeof cell === 'string' && !cell.trim())) return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) return new MoneyDecimal(cell);

  if (typeof cell === 'string') {
    let value = cell.trim();
    if (/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(value)) {
      value = value.replace(/\./g, '').replace(',', '.');
    } else if (indonesianGrouping && /^[+-]?[1-9]\d{0,2}(?:\.\d{3})+$/.test(value)) {
      value = value.replace(/\./g, '');
    }
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
      const amount = new MoneyDecimal(value);
      if (amount.isFinite()) return amount;
    }
  }
  throw new Error(`Invalid ${label}.`);
}
