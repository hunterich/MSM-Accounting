import React from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import type { Cart } from '../state/cart';
import type { PostSaleResult } from '../hooks/usePos';
import { computeSaleTotals } from '@/lib/pos/pricing';
import { toSaleLines } from '../state/cart';
import { t } from '../i18n/strings';

export default function ReceiptView({ result, cart, onNew }: { result: PostSaleResult; cart: Cart; onNew: () => void }): React.ReactElement {
  const org = useAuthStore((s) => s.org) as { name?: string; legalName?: string; displayName?: string } | null;
  const totals = computeSaleTotals(toSaleLines(cart), 11);
  const storeName = org?.displayName ?? org?.legalName ?? org?.name ?? 'Apotek';

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div id="pos-receipt" className="mx-auto max-w-xs bg-white p-4 text-sm shadow">
        <div className="text-center font-semibold">{storeName}</div>
        <div className="text-center text-xs text-gray-500">No: {result.salesInvoiceId.slice(-8)}</div>
        <hr className="my-2" />
        {cart.lines.map((l) => (
          <div key={l.itemId} className="flex justify-between">
            <span>{l.quantity}× {l.name}</span>
            <span>{(l.price * l.quantity * (1 - l.discountPct / 100)).toLocaleString('id-ID')}</span>
          </div>
        ))}
        <hr className="my-2" />
        <div className="flex justify-between"><span>PPN</span><span>{totals.taxAmount.toLocaleString('id-ID')}</span></div>
        <div className="flex justify-between font-bold"><span>{t('checkout.total')}</span><span>{result.totalAmount.toLocaleString('id-ID')}</span></div>
        <div className="flex justify-between"><span>{t('tender.change')}</span><span>{result.change.toLocaleString('id-ID')}</span></div>
      </div>
      <div className="no-print mx-auto mt-4 flex max-w-xs gap-2">
        <Button variant="secondary" className="flex-1" text={t('receipt.print')} onClick={() => window.print()} />
        <Button variant="primary" className="flex-1" text={t('receipt.newSale')} onClick={onNew} />
      </div>
    </div>
  );
}
