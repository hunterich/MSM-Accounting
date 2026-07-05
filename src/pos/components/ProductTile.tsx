import React from 'react';
import DrugClassBadge from './DrugClassBadge';
import type { CatalogRow } from '../hooks/usePos';
import { t } from '../i18n/strings';

export default function ProductTile({ item, onPick }: { item: CatalogRow; onPick: (item: CatalogRow) => void }): React.ReactElement {
  const low = item.qtyAvailable <= 10;
  const out = item.qtyAvailable <= 0;
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className={`flex h-full flex-col justify-between gap-2 rounded-xl border bg-white p-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 ${out ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <DrugClassBadge drugClass={item.drugClass} />
        <span className={`text-xs ${low ? 'text-amber-600' : 'text-gray-500'}`}>
          {item.qtyAvailable} {t('checkout.stock')}
        </span>
      </div>
      <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-800">{item.name}</div>
      <div className="text-lg font-semibold text-gray-900">{item.sellingPrice.toLocaleString('id-ID')}</div>
    </button>
  );
}
