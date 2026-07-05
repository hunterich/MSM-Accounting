import React from 'react';
import ProductTile from './ProductTile';
import type { CatalogRow } from '../hooks/usePos';

export default function ProductGrid({ items, onPick }: { items: CatalogRow[]; onPick: (item: CatalogRow) => void }): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <ProductTile key={it.id} item={it} onPick={onPick} />
      ))}
    </div>
  );
}
