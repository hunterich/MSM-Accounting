import React, { useRef, useImperativeHandle } from 'react';
import { t } from '../i18n/strings';
import type { CatalogRow } from '../hooks/usePos';

export interface ScanBoxHandle { focus: () => void }

function ScanBox(
  { catalog, onPick, term, onTermChange }: {
    catalog: CatalogRow[];
    onPick: (item: CatalogRow) => void;
    term: string;
    onTermChange: (term: string) => void;
  },
  forwardedRef: React.Ref<ScanBoxHandle>,
): React.ReactElement {
  const ref = useRef<HTMLInputElement>(null);

  useImperativeHandle(forwardedRef, () => ({ focus: () => ref.current?.focus() }), []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    const byBarcode = catalog.find((c) => c.barcode === q);
    if (byBarcode) { onPick(byBarcode); onTermChange(''); }
  }

  return (
    <form onSubmit={submit}>
      <input
        ref={ref}
        autoFocus
        className="w-full rounded-xl border p-2.5 text-lg"
        placeholder={t('checkout.scan')}
        value={term}
        onChange={(e) => onTermChange(e.target.value)}
      />
    </form>
  );
}

export default React.forwardRef(ScanBox);
