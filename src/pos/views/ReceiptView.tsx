import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import type { Cart } from '../state/cart';
import type { PostSaleResult } from '../hooks/usePos';
import { computeSaleTotals } from '@/lib/pos/pricing';
import { toSaleLines } from '../state/cart';
import { t } from '../i18n/strings';

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtDelta = (n: number) => `${n < 0 ? '-' : '+'}${Math.abs(n).toLocaleString('id-ID')}`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/** Build a self-contained HTML receipt and print it via a hidden iframe (robust, no popup blocker). */
function printReceiptHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();
  window.setTimeout(() => {
    iframe.contentWindow?.print();
    window.setTimeout(() => document.body.removeChild(iframe), 800);
  }, 150);
}

export default function ReceiptView({ result, cart, onNew }: { result: PostSaleResult; cart: Cart; onNew: () => void }): React.ReactElement {
  const org = useAuthStore((s) => s.org) as { name?: string; legalName?: string; displayName?: string } | null;
  const user = useAuthStore((s) => s.user);
  const [soldAt] = useState(() => new Date());

  const totals = computeSaleTotals(toSaleLines(cart), 11);
  const storeName = org?.displayName ?? org?.legalName ?? org?.name ?? 'Apotek';
  const cashier = user?.fullName ?? user?.email ?? '';
  const invoiceNo = result.salesInvoiceId.slice(-8).toUpperCase();
  const cash = result.totalAmount + result.change;
  const dateStr = soldAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });

  const lines = cart.lines.map((l) => ({
    qty: l.quantity,
    name: l.name,
    total: l.price * l.quantity * (1 - l.discountPct / 100),
    modifiers: l.modifiers,
    note: l.modifierNote,
  }));

  function print() {
    const rows = lines
      .map((l) => {
        const mods = l.modifiers
          .map((m) => `<div class="row sub"><span>+ ${escapeHtml(m.optionName)}</span><span>${m.priceDelta !== 0 ? fmtDelta(m.priceDelta) : ''}</span></div>`)
          .join('');
        const note = l.note ? `<div class="sub i">${escapeHtml(l.note)}</div>` : '';
        return `<div class="row"><span>${l.qty}× ${escapeHtml(l.name)}</span><span>${fmt(l.total)}</span></div>${mods}${note}`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Struk</title><style>
      @page { margin: 4mm; }
      * { box-sizing: border-box; }
      body { width: 72mm; margin: 0 auto; font-family: 'Courier New', monospace; font-size: 12px; color: #000; }
      .c { text-align: center; } .b { font-weight: bold; } .sm { font-size: 11px; }
      .row { display: flex; justify-content: space-between; gap: 8px; }
      .sub { padding-left: 10px; font-size: 11px; }
      .i { font-style: italic; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    </style></head><body>
      <div class="c b">${escapeHtml(storeName)}</div>
      <div class="c sm">${dateStr}</div>
      <div class="c sm">No: ${invoiceNo}${cashier ? ` · ${escapeHtml(cashier)}` : ''}</div>
      <hr/>
      ${rows}
      <hr/>
      <div class="row"><span>Subtotal</span><span>${fmt(totals.subtotal)}</span></div>
      <div class="row"><span>PPN 11%</span><span>${fmt(totals.taxAmount)}</span></div>
      <div class="row b"><span>Total</span><span>${fmt(result.totalAmount)}</span></div>
      <div class="row"><span>Tunai</span><span>${fmt(cash)}</span></div>
      <div class="row"><span>Kembalian</span><span>${fmt(result.change)}</span></div>
      <hr/>
      <div class="c sm">Terima kasih</div>
    </body></html>`;
    printReceiptHtml(html);
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-xs rounded-lg bg-white p-4 text-sm shadow">
        <div className="text-center font-semibold">{storeName}</div>
        <div className="text-center text-xs text-gray-500">{dateStr}</div>
        <div className="text-center text-xs text-gray-500">No: {invoiceNo}{cashier ? ` · ${cashier}` : ''}</div>
        <hr className="my-2" />
        {lines.map((l, i) => (
          <div key={i}>
            <div className="flex justify-between">
              <span>{l.qty}× {l.name}</span>
              <span className="tabular-nums">{fmt(l.total)}</span>
            </div>
            {l.modifiers.map((m) => (
              <div key={m.optionId} className="flex justify-between pl-3 text-xs text-gray-500">
                <span>+ {m.optionName}</span>
                {m.priceDelta !== 0 && <span className="tabular-nums">{fmtDelta(m.priceDelta)}</span>}
              </div>
            ))}
            {l.note && <div className="pl-3 text-xs italic text-gray-500">{l.note}</div>}
          </div>
        ))}
        <hr className="my-2" />
        <div className="flex justify-between text-gray-600"><span>{t('checkout.subtotal')}</span><span className="tabular-nums">{fmt(totals.subtotal)}</span></div>
        <div className="flex justify-between text-gray-600"><span>{t('checkout.ppn')}</span><span className="tabular-nums">{fmt(totals.taxAmount)}</span></div>
        <div className="flex justify-between font-bold"><span>{t('checkout.total')}</span><span className="tabular-nums">{fmt(result.totalAmount)}</span></div>
        <div className="flex justify-between"><span>{t('tender.cash')}</span><span className="tabular-nums">{fmt(cash)}</span></div>
        <div className="flex justify-between"><span>{t('tender.change')}</span><span className="tabular-nums">{fmt(result.change)}</span></div>
      </div>
      <div className="mx-auto mt-4 flex max-w-xs gap-2">
        <Button variant="secondary" className="flex-1" text={t('receipt.print')} onClick={print} />
        <Button variant="primary" className="flex-1" text={t('receipt.newSale')} onClick={onNew} />
      </div>
    </div>
  );
}
