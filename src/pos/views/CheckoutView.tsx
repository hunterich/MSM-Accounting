import React, { useEffect, useRef, useState } from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { computeSaleTotals } from '@/lib/pos/pricing';
import { useCatalog, useRegisters, usePostSale, type CatalogRow, type PostSaleResult } from '../hooks/usePos';
import { emptyCart, addItem, setQty, removeLine, toSaleLines, type Cart } from '../state/cart';
import ScanBox, { type ScanBoxHandle } from '../components/ScanBox';
import StatusBar from '../components/StatusBar';
import CategoryChips, { matchesCategory, type CategoryFilter } from '../components/CategoryChips';
import ProductGrid from '../components/ProductGrid';
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
  const registers = useRegisters();
  const postSale = usePostSale();
  const [cart, setCart] = useState<Cart>(emptyCart());
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ result: PostSaleResult; lines: Cart } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saleId, setSaleId] = useState(uuid());
  const scanRef = useRef<ScanBoxHandle>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); if (cart.lines.length > 0) setPayOpen(true); }
      else if (e.key === 'Escape') { setPayOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart.lines.length]);

  if (catalog.isError && (catalog.error as { status?: number })?.status === 403) {
    return <div className="flex h-screen items-center justify-center text-red-600">{t('auth.forbidden')}</div>;
  }
  if (receipt) {
    return <ReceiptView result={receipt.result} cart={receipt.lines} onNew={() => { setReceipt(null); setCart(emptyCart()); setTerm(''); setSaleId(uuid()); }} />;
  }

  const pick = (item: CatalogRow) => { setCart((c) => addItem(c, item)); setTerm(''); };
  const totals = computeSaleTotals(toSaleLines(cart), 11);
  const registerName = (registers.data ?? []).find((r) => r.id === registerId)?.name ?? t('shift.register');

  const items = (catalog.data ?? []).filter((it) => {
    if (!matchesCategory(category, it.drugClass)) return false;
    const q = term.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q) || (it.barcode ?? '').toLowerCase().includes(q);
  });

  async function pay(cash: number) {
    setError(null);
    try {
      const result = await postSale.mutateAsync({ clientSaleId: saleId, registerId, shiftId, lines: toSaleLines(cart), tenders: [{ method: 'CASH', amount: cash }] });
      setPayOpen(false);
      setReceipt({ result, lines: cart });
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <StatusBar registerName={registerName} onLogout={() => logout()} onCloseShift={onCloseShift} />

      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-3 p-3">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="relative">
            <ScanBox ref={scanRef} catalog={catalog.data ?? []} term={term} onTermChange={setTerm} onPick={pick} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-white px-1.5 py-0.5 text-xs text-gray-400">F2</span>
          </div>
          <CategoryChips selected={category} onSelect={setCategory} />
          <div className="min-h-0 flex-1 overflow-auto">
            {catalog.isLoading
              ? <p className="p-8 text-center text-gray-400">…</p>
              : <ProductGrid items={items} onPick={pick} />}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-medium text-gray-800">{t('checkout.cart')}</span>
            <span className="text-sm text-gray-500">{cart.lines.length} {t('checkout.items')}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4">
            <CartLines cart={cart} onQty={(id, q) => setCart((c) => setQty(c, id, q))} onRemove={(id) => setCart((c) => removeLine(c, id))} />
          </div>
          <div className="border-t px-4 py-3">
            <div className="mb-1 flex justify-between text-sm text-gray-500"><span>{t('checkout.subtotal')}</span><span className="tabular-nums">{totals.subtotal.toLocaleString('id-ID')}</span></div>
            <div className="mb-2 flex justify-between text-sm text-gray-500"><span>{t('checkout.ppn')}</span><span className="tabular-nums">{totals.taxAmount.toLocaleString('id-ID')}</span></div>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="font-medium text-gray-800">{t('checkout.total')}</span>
              <span className="text-2xl font-semibold tabular-nums">Rp {totals.totalAmount.toLocaleString('id-ID')}</span>
            </div>
            {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
            <Button variant="primary" size="lg" className="w-full" disabled={cart.lines.length === 0} text={`${t('checkout.pay')} · F4`} onClick={() => setPayOpen(true)} />
          </div>
        </aside>
      </div>

      <CashTenderModal total={totals.totalAmount} isOpen={payOpen} onClose={() => setPayOpen(false)} onConfirm={pay} busy={postSale.isPending} />
    </div>
  );
}
