import React from 'react';
import { Trash2 } from 'lucide-react';
import type { Cart } from '../state/cart';
import { t } from '../i18n/strings';

export default function CartLines({ cart, onQty, onRemove }: { cart: Cart; onQty: (itemId: string, qty: number) => void; onRemove: (itemId: string) => void }): React.ReactElement {
  if (cart.lines.length === 0) return <p className="p-8 text-center text-gray-400">{t('checkout.empty')}</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {cart.lines.map((l) => (
          <tr key={l.itemId} className="border-b">
            <td className="py-2">{l.name}</td>
            <td className="py-2 text-center">
              <input aria-label={t('checkout.qty')} type="number" min={0} value={l.quantity}
                className="w-16 rounded border p-1 text-center"
                onChange={(e) => onQty(l.itemId, Number(e.target.value))} />
            </td>
            <td className="py-2 text-right">{(l.price * l.quantity * (1 - l.discountPct / 100)).toLocaleString('id-ID')}</td>
            <td className="py-2 pl-2 text-right">
              <button aria-label="remove" onClick={() => onRemove(l.itemId)}><Trash2 size={16} className="text-gray-400 hover:text-red-600" /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
