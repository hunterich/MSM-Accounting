import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Cart } from '../state/cart';
import { t } from '../i18n/strings';

/** Format an ISO date as `MM/YY`, or null if unparseable. */
function expMonthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

export default function CartLines({ cart, onQty, onRemove }: { cart: Cart; onQty: (itemId: string, qty: number) => void; onRemove: (itemId: string) => void }): React.ReactElement {
  if (cart.lines.length === 0) return <p className="p-8 text-center text-gray-400">{t('checkout.empty')}</p>;
  return (
    <ul className="divide-y">
      {cart.lines.map((l) => {
        const exp = expMonthYear(l.earliestExpiry);
        const lineTotal = l.price * l.quantity * (1 - l.discountPct / 100);
        return (
          <li key={l.itemId} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-800">{l.name}</div>
              {exp && <div className="text-xs text-gray-400">{t('checkout.exp')} {exp}</div>}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t('checkout.qty')}
                onClick={() => onQty(l.itemId, l.quantity - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-gray-600 hover:bg-gray-50"
              >
                <Minus size={16} />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{l.quantity}</span>
              <button
                type="button"
                aria-label={t('checkout.qty')}
                onClick={() => onQty(l.itemId, l.quantity + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-gray-600 hover:bg-gray-50"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="w-24 text-right text-sm font-medium tabular-nums text-gray-800">{lineTotal.toLocaleString('id-ID')}</div>
            <button
              type="button"
              aria-label="remove"
              onClick={() => onRemove(l.itemId)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
