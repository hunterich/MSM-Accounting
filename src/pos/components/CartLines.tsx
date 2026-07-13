import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Cart } from '../state/cart';
import { t } from '../i18n/strings';

/** Format a tax-inclusive price delta with an explicit sign, e.g. `+5.000`. */
function formatDelta(n: number): string {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toLocaleString('id-ID')}`;
}

/** Format an ISO date as `MM/YY`, or null if unparseable. */
function expMonthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

export default function CartLines({ cart, onQty, onRemove }: { cart: Cart; onQty: (key: string, qty: number) => void; onRemove: (key: string) => void }): React.ReactElement {
  if (cart.lines.length === 0) return <p className="p-8 text-center text-gray-400">{t('checkout.empty')}</p>;
  return (
    <ul className="divide-y">
      {cart.lines.map((l) => {
        const exp = expMonthYear(l.earliestExpiry);
        const lineTotal = l.price * l.quantity * (1 - l.discountPct / 100);
        return (
          <li key={l.key} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-800">{l.name}</div>
              {l.modifiers.length > 0 && (
                <ul className="mt-0.5 space-y-0.5">
                  {l.modifiers.map((m) => (
                    <li key={m.optionId} className="flex justify-between gap-2 text-xs text-gray-400">
                      <span className="truncate">+ {m.optionName}</span>
                      {m.priceDelta !== 0 && <span className="shrink-0 tabular-nums">{formatDelta(m.priceDelta)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {l.modifierNote && <div className="truncate text-xs italic text-gray-400">{l.modifierNote}</div>}
              {exp && <div className="text-xs text-gray-400">{t('checkout.exp')} {exp}</div>}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t('checkout.qty')}
                onClick={() => onQty(l.key, l.quantity - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-gray-600 hover:bg-gray-50"
              >
                <Minus size={16} />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{l.quantity}</span>
              <button
                type="button"
                aria-label={t('checkout.qty')}
                onClick={() => onQty(l.key, l.quantity + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-gray-600 hover:bg-gray-50"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="w-24 text-right text-sm font-medium tabular-nums text-gray-800">{lineTotal.toLocaleString('id-ID')}</div>
            <button
              type="button"
              aria-label="remove"
              onClick={() => onRemove(l.key)}
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
