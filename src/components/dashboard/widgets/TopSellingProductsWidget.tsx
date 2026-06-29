import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import { api } from '../../../api/apiClient';
import { formatNumber } from '../../../utils/formatters';
import { currentQuarter, quarterRange, stepQuarter, formatQuarterLabel } from '../../../utils/quarter';

interface ProductRow extends Record<string, unknown> {
    rank: number;
    name: string;
    qty: string;
}

interface TopProductsResponse {
    rows: Array<{ itemId: string; sku: string; name: string; qty: number; total: number }>;
}

const columns: TableColumn<ProductRow>[] = [
    { key: 'rank', label: '#' },
    { key: 'name', label: 'Product' },
    { key: 'qty', label: 'Qty Sold', align: 'right' },
];

const TopSellingProductsWidget = (): React.ReactElement => {
    const [{ year, quarter }, setQ] = useState(() => currentQuarter());
    const { dateFrom, dateTo } = useMemo(() => quarterRange(year, quarter), [year, quarter]);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['top-selling-products', year, quarter],
        queryFn: () => api.get<TopProductsResponse>('/api/v1/reports/sales', {
            type: 'top-products', topN: 20, sortBy: 'qty', dateFrom, dateTo,
        }),
    });

    const rows = useMemo<ProductRow[]>(() =>
        (data?.rows ?? []).map((r, i) => ({
            rank: i + 1,
            name: r.name || '—',
            qty: formatNumber(r.qty),
        })),
        [data]
    );

    const step = (delta: number): void => setQ((q) => stepQuarter(q.year, q.quarter, delta));

    const arrowBtn = 'p-1 rounded text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors cursor-pointer bg-transparent border-0';

    return (
        <Card
            title="Best Selling Products"
            actions={
                <>
                    <button className={arrowBtn} onClick={() => step(-1)} aria-label="Previous quarter">
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-medium text-neutral-700 min-w-[64px] text-center">
                        {formatQuarterLabel(year, quarter)}
                    </span>
                    <button className={arrowBtn} onClick={() => step(1)} aria-label="Next quarter">
                        <ChevronRight size={16} />
                    </button>
                </>
            }
        >
            {isLoading ? (
                <div className="module-empty-state">Loading…</div>
            ) : isError ? (
                <div className="module-empty-state">Couldn&apos;t load top products.</div>
            ) : rows.length === 0 ? (
                <div className="module-empty-state">No sales in {formatQuarterLabel(year, quarter)}.</div>
            ) : (
                <div className="max-h-96 overflow-y-auto">
                    <Table columns={columns as TableColumn<Record<string, unknown>>[]} data={rows} />
                </div>
            )}
        </Card>
    );
};

export default TopSellingProductsWidget;
