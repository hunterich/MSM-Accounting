import React, { useEffect, useRef, useState } from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { posSaleBreakdown, pricePosSale, type PosSaleBreakdown } from '@/lib/pos/pricing';
import { validateCashTender } from '@/lib/pos/tender';
import { useCatalog, useRegisters, usePostSale, type CatalogRow, type SalesTypeRow, type PostSaleResult } from '../hooks/usePos';
import { useOfflineSync, cacheCatalog, readCachedCatalog, cacheSalesTypes, readCachedSalesTypes } from '../hooks/useOfflinePos';
import { db } from '../offline/db';
import { emptyCart, addItem, addConfiguredItem, setQty, removeLine, toSaleLines, type Cart } from '../state/cart';
import ScanBox, { type ScanBoxHandle } from '../components/ScanBox';
import ModifierModal from '../components/ModifierModal';
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
  const { online, enqueueOp } = useOfflineSync();
  const catalog = useCatalog(true);
  const registers = useRegisters();
  const postSale = usePostSale();
  const [cachedCatalog, setCachedCatalog] = useState<CatalogRow[]>([]);
  const [cachedSalesTypes, setCachedSalesTypes] = useState<SalesTypeRow[]>([]);
  const [salesTypeId, setSalesTypeId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>(emptyCart());
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ result: PostSaleResult; lines: Cart; lineTotals: number[]; breakdown: PosSaleBreakdown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saleId, setSaleId] = useState(uuid());
  const [pendingItem, setPendingItem] = useState<CatalogRow | null>(null);
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

  // Cache the catalog + sales types whenever they load successfully, so the grid
  // and the sales-type selector work offline.
  useEffect(() => {
    if (catalog.data) { void cacheCatalog(catalog.data.items); void cacheSalesTypes(catalog.data.salesTypes); }
  }, [catalog.data]);

  // On mount, load the cached catalog + sales types so we have a fallback when the online query is in error offline.
  useEffect(() => {
    void readCachedCatalog().then(setCachedCatalog);
    void readCachedSalesTypes().then(setCachedSalesTypes);
  }, []);

  // Default the sales-type selection to this register's default (falling back to the
  // first available type) once the types + register are loaded — but never override a
  // choice the cashier has already made this sale.
  const availableSalesTypes = catalog.data?.salesTypes ?? cachedSalesTypes;
  useEffect(() => {
    if (salesTypeId != null) return;
    if (availableSalesTypes.length === 0) return;
    const registerDefault = (registers.data ?? []).find((r) => r.id === registerId)?.defaultSalesTypeId ?? null;
    const preferred = registerDefault && availableSalesTypes.some((s) => s.id === registerDefault)
      ? registerDefault
      : availableSalesTypes[0].id;
    setSalesTypeId(preferred);
  }, [availableSalesTypes, registers.data, registerId, salesTypeId]);

  if (catalog.isError && (catalog.error as { status?: number })?.status === 403) {
    return <div className="flex h-screen items-center justify-center text-red-600">{t('auth.forbidden')}</div>;
  }
  if (receipt) {
    return <ReceiptView result={receipt.result} cart={receipt.lines} lineTotals={receipt.lineTotals} breakdown={receipt.breakdown} onNew={() => { setReceipt(null); setCart(emptyCart()); setTerm(''); setSaleId(uuid()); }} />;
  }

  const pick = (item: CatalogRow) => {
    setTerm('');
    // Items with modifier groups open the configuration modal (required groups force a choice);
    // items without groups take the fast add-to-cart path. Applies to both grid taps and scans.
    if (item.modifierGroups && item.modifierGroups.length > 0) { setPendingItem(item); return; }
    setCart((c) => addItem(c, item));
  };
  const register = (registers.data ?? []).find((r) => r.id === registerId);
  const registerName = register?.name ?? t('shift.register');

  // Prefer the live catalog; fall back to the cached rows whenever there's no live data.
  // (React Query pauses — not errors — offline, so don't gate the fallback on isError.)
  const catalogRows = catalog.data?.items ?? cachedCatalog;

  const selectedSalesType = availableSalesTypes.find(s => s.id === (salesTypeId ?? register?.defaultSalesTypeId))
    ?? availableSalesTypes[0] ?? null;
  const saleLines = toSaleLines(cart);
  const pricing = pricePosSale(saleLines, selectedSalesType);
  const breakdown = posSaleBreakdown(pricing);
  const displayTotal = pricing.totalAmount.toNumber();
  const lineTotals = pricing.cartLineTotals.map(amount => amount.toNumber());
  const selectedTypeId = selectedSalesType?.id ?? null;

  const items = catalogRows.filter((it) => {
    if (!matchesCategory(category, it.drugClass)) return false;
    const q = term.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q) || (it.barcode ?? '').toLowerCase().includes(q);
  });

  // Enqueue the sale locally and show a receipt built from local data (used when offline or on a network failure).
  async function payOffline(cash: number) {
    const tender = validateCashTender(displayTotal, cash);
    if (!tender.ok) return;
    const current = await db.shiftState.get('current');
    const currentServerShiftId = current?.serverShiftId; // set for online-opened shifts; undefined for offline-opened
    await enqueueOp({
      localId: uuid(),
      type: 'sale',
      clientShiftId: shiftId,
      createdAt: Date.now(),
      payload: {
        clientSaleId: saleId,
        clientShiftId: shiftId,
        registerId,
        shiftId: currentServerShiftId,
        salesTypeId: selectedTypeId,
        lines: saleLines,
        quotedTotal: displayTotal,
        tenders: [{ method: 'CASH', amount: cash }],
      },
    });
    const result: PostSaleResult = { posSaleId: saleId, salesInvoiceId: saleId, totalAmount: displayTotal, change: tender.change };
    setPayOpen(false);
    setReceipt({ result, lines: cart, lineTotals, breakdown });
  }

  async function pay(cash: number) {
    setError(null);
    // Offline up-front: skip the network entirely and queue the sale.
    if (!online) { await payOffline(cash); return; }
    try {
      const result = await postSale.mutateAsync({ clientSaleId: saleId, registerId, shiftId, salesTypeId: selectedTypeId, lines: saleLines, tenders: [{ method: 'CASH', amount: cash }] });
      setPayOpen(false);
      setReceipt({ result, lines: cart, lineTotals, breakdown: result.breakdown ?? breakdown });
    } catch (err) {
      // A network error (no HTTP status) means the server was unreachable → fall back to the offline queue.
      if ((err as { status?: number }).status === undefined) { await payOffline(cash); return; }
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <StatusBar registerName={registerName} onLogout={() => logout()} onCloseShift={onCloseShift} />

      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-3 p-3">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="relative">
            <ScanBox ref={scanRef} catalog={catalogRows} term={term} onTermChange={setTerm} onPick={pick} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-white px-1.5 py-0.5 text-xs text-gray-400">F2</span>
          </div>
          <CategoryChips selected={category} onSelect={setCategory} />
          <div className="min-h-0 flex-1 overflow-auto">
            {catalog.isLoading && catalogRows.length === 0
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
            <CartLines cart={cart} lineTotals={lineTotals} onQty={(key, q) => setCart((c) => setQty(c, key, q))} onRemove={(key) => setCart((c) => removeLine(c, key))} />
          </div>
          <div className="border-t px-4 py-3">
            {availableSalesTypes.length > 0 && (
              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-medium text-gray-500">{t('checkout.salesType')}</span>
                <select
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
                  value={selectedTypeId ?? ''}
                  onChange={(e) => setSalesTypeId(e.target.value || null)}
                >
                  {availableSalesTypes.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="mb-1 flex justify-between text-sm text-gray-500"><span>{t('checkout.subtotal')}</span><span className="tabular-nums">{breakdown.subtotal.toLocaleString('id-ID')}</span></div>
            {breakdown.serviceChargeNet > 0 && (
              <div className="mb-2 flex justify-between text-sm text-gray-500"><span>{t('checkout.serviceCharge')}</span><span className="tabular-nums">{breakdown.serviceChargeNet.toLocaleString('id-ID')}</span></div>
            )}
            <div className="mb-2 flex justify-between text-sm text-gray-500"><span>{t('checkout.ppn')}</span><span className="tabular-nums">{breakdown.taxAmount.toLocaleString('id-ID')}</span></div>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="font-medium text-gray-800">{t('checkout.total')}</span>
              <span className="text-2xl font-semibold tabular-nums">Rp {displayTotal.toLocaleString('id-ID')}</span>
            </div>
            {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
            <Button variant="primary" size="lg" className="w-full" disabled={cart.lines.length === 0} text={`${t('checkout.pay')} · F4`} onClick={() => setPayOpen(true)} />
          </div>
        </aside>
      </div>

      <CashTenderModal total={displayTotal} isOpen={payOpen} onClose={() => setPayOpen(false)} onConfirm={pay} busy={postSale.isPending} />

      {pendingItem && (
        <ModifierModal
          item={pendingItem}
          groups={pendingItem.modifierGroups ?? []}
          onCancel={() => setPendingItem(null)}
          onConfirm={(mods) => { setCart((c) => addConfiguredItem(c, pendingItem, mods)); setPendingItem(null); }}
        />
      )}
    </div>
  );
}
