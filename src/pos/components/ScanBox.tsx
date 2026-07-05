import React, { useRef } from 'react';
import { t } from '../i18n/strings';
import type { CatalogRow } from '../hooks/usePos';

export default function ScanBox({ catalog, onPick }: { catalog: CatalogRow[]; onPick: (item: CatalogRow) => void }): React.ReactElement {
  const [term, setTerm] = React.useState('');
  const ref = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    const byBarcode = catalog.find((c) => c.barcode === q);
    if (byBarcode) { onPick(byBarcode); setTerm(''); }
  }

  const matches = term.trim()
    ? catalog.filter((c) => c.name.toLowerCase().includes(term.toLowerCase()) || c.sku.toLowerCase().includes(term.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <form onSubmit={submit}>
        <input
          ref={ref}
          autoFocus
          className="w-full rounded border p-2 text-lg"
          placeholder={t('checkout.scan')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </form>
      {matches.length > 0 && (
        <ul className="mt-1 max-h-64 overflow-auto rounded border bg-white">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-gray-50" onClick={() => { onPick(m); setTerm(''); ref.current?.focus(); }}>
                <span>{m.name}</span><span className="text-gray-500">{m.sellingPrice.toLocaleString('id-ID')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
