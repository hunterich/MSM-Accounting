import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { useCatalog, usePostSale, type CatalogRow, type PostSaleResult } from '../hooks/usePos';
import { emptyCart, addItem, setQty, removeLine, cartTotal, toSaleLines, type Cart } from '../state/cart';
import ScanBox from '../components/ScanBox';
import CartLines from '../components/CartLines';
import CashTenderModal from '../components/CashTenderModal';
import ReceiptView from './ReceiptView';
import { t } from '../i18n/strings';

function uuid(): string {
  return (crypto as Crypto).randomUUID();
}

export default function CheckoutView({ shiftId, registerId, onCloseShift }: { shiftId: string; registerId: string; onCloseShift: () => void }): React.ReactElement {
  const logout = useAuthStore((s) => s.logout);
  const catalog = useCatalog(true);
  const postSale = usePostSale();
  const [cart, setCart] = useState<Cart>(emptyCart());
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ result: PostSaleResult; lines: Cart } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saleId, setSaleId] = useState(uuid());

  if (catalog.isError && (catalog.error as { status?: number })?.status === 403) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{t('auth.forbidden')}</div>;
  }
  if (receipt) {
    return <ReceiptView result={receipt.result} cart={receipt.lines} onNew={() => { setReceipt(null); setCart(emptyCart()); setSaleId(uuid()); }} />;
  }

  const total = cartTotal(cart);

  async function pay(cash: number) {
    setError(null);
    try {
      const result = await postSale.mutateAsync({ clientSaleId: saleId, registerId, shiftId, lines: toSaleLines(cart), tenders: [{ method: 'CASH', amount: cash }] });
      setPayOpen(false);
      setReceipt({ result, lines: cart });
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <span className="font-semibold">{t('app.title')}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" text={t('shift.close')} onClick={onCloseShift} />
          <Button variant="ghost" size="sm" text={t('auth.logout')} onClick={() => logout()} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <ScanBox catalog={catalog.data ?? []} onPick={(item: CatalogRow) => setCart((c) => addItem(c, item))} />
        <div className="mt-4 rounded-lg bg-white p-4 shadow">
          <CartLines cart={cart} onQty={(id, q) => setCart((c) => setQty(c, id, q))} onRemove={(id) => setCart((c) => removeLine(c, id))} />
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <span className="text-xl font-bold">{t('checkout.total')}: {total.toLocaleString('id-ID')}</span>
            <Button variant="primary" size="lg" text={t('checkout.pay')} disabled={cart.lines.length === 0} onClick={() => setPayOpen(true)} />
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </main>
      <CashTenderModal total={total} isOpen={payOpen} onClose={() => setPayOpen(false)} onConfirm={pay} busy={postSale.isPending} />
    </div>
  );
}
