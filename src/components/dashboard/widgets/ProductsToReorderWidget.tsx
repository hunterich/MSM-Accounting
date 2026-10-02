import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import { useAllItems } from '../../../hooks/useInventory';
import { productsToReorder } from '../../../utils/inventoryStock';
import { formatNumber } from '../../../utils/formatters';

const BANDS = [
    { label: '> 67%', color: 'bg-warning-300', matches: (p: number) => p > 67 },
    { label: '33–67%', color: 'bg-orange-400', matches: (p: number) => p >= 33 && p <= 67 },
    { label: '< 33%', color: 'bg-danger-500', matches: (p: number) => p < 33 },
];

export default function ProductsToReorderWidget(): React.ReactElement {
    const navigate = useNavigate();
    const { data, isLoading, isError, isFetching, refetch } = useAllItems({ isActive: 'true' });
    const items = useMemo(() => productsToReorder(data?.data ?? []), [data]);
    const bands = BANDS.map((band) => ({ ...band, count: items.filter((item) => band.matches(item.stockPercent)).length }));

    return (
        <Card title="Products to Reorder" actions={
            <button type="button" onClick={() => void refetch()} disabled={isFetching}
                className="p-1 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                aria-label="Refresh products to reorder">
                <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
            </button>
        }>
            <p className="text-xs text-neutral-500 mb-3">All warehouses · active stock items</p>
            {isLoading ? <div className="module-empty-state">Loading stock…</div>
                : isError ? <div role="alert" className="module-empty-state">Couldn&apos;t load stock. Try refreshing.</div>
                : <>
                    <div className="flex justify-between items-center mb-3 font-semibold text-neutral-900">
                        <span>Total Items</span><span className="text-2xl">{items.length}</span>
                    </div>
                    <div className="flex h-9 overflow-hidden rounded bg-neutral-100" role="img"
                        aria-label={bands.map((b) => `${b.label} of minimum stock: ${b.count} items`).join(', ')}>
                        {bands.filter((b) => b.count > 0).map((b) => (
                            <div key={b.label} className={`${b.color} border-r border-white last:border-0`}
                                style={{ width: `${b.count / items.length * 100}%` }} title={`${b.label}: ${b.count} items`} />
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mt-3 mb-4">
                        {bands.map((b) => <span key={b.label} className="flex items-center gap-1">
                            <span className={`w-3 h-3 ${b.color}`} />{b.label} ({b.count})
                        </span>)}
                    </div>
                    <p className="text-xs text-neutral-500 mb-3">Current stock as a percentage of minimum stock. Items with no minimum are excluded.</p>
                    {items.length === 0 ? <p className="text-sm text-neutral-600 py-4">No products below their minimum stock.</p>
                        : <div className="max-h-64 overflow-y-auto divide-y divide-neutral-100">
                            {items.map((item) => <button type="button" key={item.id}
                                onClick={() => navigate(`/inventory/new?mode=view&itemId=${encodeURIComponent(item.id)}`)}
                                className="w-full text-left py-3 hover:bg-neutral-50 rounded px-1">
                                <div className="flex justify-between gap-2 text-sm">
                                    <span className="font-medium text-neutral-900 truncate">{item.name}</span>
                                    <span className="text-danger-600 whitespace-nowrap">{formatNumber(item.stockPercent)}%</span>
                                </div>
                                <div className="text-xs text-neutral-500 mt-1">{item.sku} · Stock {formatNumber(item.currentStock)} / minimum {formatNumber(item.reorderPoint)} {item.unit}</div>
                                <div className="text-xs text-neutral-600 mt-1">Needed to reach minimum: {formatNumber(item.shortage)} {item.unit}</div>
                            </button>)}
                        </div>}
                </>}
        </Card>
    );
}
