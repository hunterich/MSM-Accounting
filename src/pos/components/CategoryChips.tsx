import React from 'react';
import { t } from '../i18n/strings';

export type CategoryFilter = 'ALL' | 'BEBAS' | 'TERBATAS' | 'KERAS' | 'UMUM';

/** Drug classes that belong to each chip. `ALL` matches everything. */
const CATEGORY_CLASSES: Record<Exclude<CategoryFilter, 'ALL'>, string[]> = {
  BEBAS:    ['OBAT_BEBAS'],
  TERBATAS: ['OBAT_BEBAS_TERBATAS'],
  KERAS:    ['OBAT_KERAS', 'PSIKOTROPIKA', 'NARKOTIKA'],
  UMUM:     ['NON_OBAT'],
};

/** True if the given drugClass matches the selected chip filter. */
export function matchesCategory(filter: CategoryFilter, drugClass: string): boolean {
  if (filter === 'ALL') return true;
  return CATEGORY_CLASSES[filter].includes(drugClass);
}

const CHIPS: { value: CategoryFilter; labelKey: 'cat.all' | 'cat.bebas' | 'cat.terbatas' | 'cat.keras' | 'cat.umum' }[] = [
  { value: 'ALL',      labelKey: 'cat.all' },
  { value: 'BEBAS',    labelKey: 'cat.bebas' },
  { value: 'TERBATAS', labelKey: 'cat.terbatas' },
  { value: 'KERAS',    labelKey: 'cat.keras' },
  { value: 'UMUM',     labelKey: 'cat.umum' },
];

export default function CategoryChips({ selected, onSelect }: { selected: CategoryFilter; onSelect: (filter: CategoryFilter) => void }): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const active = chip.value === selected;
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onSelect(chip.value)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'border-gray-800 bg-gray-800 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t(chip.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
