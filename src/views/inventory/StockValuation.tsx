import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import ListPage from '../../components/Layout/ListPage';
import { Download } from 'lucide-react';
import { formatIDR, formatNumber } from '../../utils/formatters';
import { useStockValuation, useWarehouses, StockValuationRow } from '../../hooks/useInventory';
import { useItemCategories } from '../../hooks/useInventory';
import { exportToExcel } from '../../utils/exportExcel';

// ── Component ─────────────────────────────────────────────────────────────────

const StockValuation: React.FC = () => {
    const [categoryId, setCategoryId] = useState('');
    const [warehouseId, setWarehouseId] = useState('');

    const filters = useMemo(() => ({
        ...(categoryId ? { categoryId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
    }), [categoryId, warehouseId]);

    const { data, isLoading } = useStockValuation(filters);
    const categories = useItemCategories().data ?? [];
    const warehouses = useWarehouses().data ?? [];

    // The valuation endpoint returns categoryId only, so resolve names here.
    const categoryNameById = useMemo(
        () => new Map(categories.map((c) => [c.id, c.name])),
        [categories],
    );
    const rows: StockValuationRow[] = useMemo(
        () => (data?.rows ?? []).map((r) => ({
            ...r,
            category: (r.categoryId && categoryNameById.get(r.categoryId)) || r.category || '',
        })),
        [data, categoryNameById],
    );
    const totalValue: number = data?.totalValue ?? rows.reduce((s, r) => s + r.totalValue, 0);

    const handleExportExcel = () => {
        exportToExcel(
            `stock-valuation-${new Date().toISOString().slice(0, 10)}.xlsx`,
            'Stock Valuation',
            [
                { label: 'SKU', key: 'sku' },
                { label: 'Item Name', key: 'itemName' },
                { label: 'Category', key: 'category' },
                { label: 'Qty on Hand', key: 'qtyOnHand' },
                { label: 'Avg Unit Cost', key: 'avgUnitCost' },
                { label: 'Total Value', key: 'totalValue' },
            ],
            rows as unknown as Record<string, unknown>[],
        );
    };

    const columns: TableColumn<StockValuationRow & Record<string, unknown>>[] = [
        { key: 'sku', label: 'SKU', sortable: true },
        { key: 'itemName', label: 'Item Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        {
            key: 'qtyOnHand', label: 'Qty on Hand', align: 'right',
            render: (val) => formatNumber(Number(val)),
        },
        {
            key: 'avgUnitCost', label: 'Avg Unit Cost', align: 'right',
            render: (val) => formatIDR(val as number),
        },
        {
            key: 'totalValue', label: 'Total Value', align: 'right',
            render: (val) => <span className="font-medium">{formatIDR(val as number)}</span>,
        },
    ];

    return (
        <ListPage
            title="Stock Valuation"
            subtitle="Current inventory value based on costing method."
            actions={
                <Button
                    text="Export Excel"
                    variant="secondary"
                    icon={<Download size={16} />}
                    onClick={handleExportExcel}
                    disabled={rows.length === 0}
                />
            }
        >
            {/* Filters */}
            <div className="flex gap-3 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-neutral-600 whitespace-nowrap">Category:</label>
                    <select
                        className="h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 min-w-[180px]"
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                    >
                        <option value="">All Categories</option>
                        {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm text-neutral-600 whitespace-nowrap">Warehouse:</label>
                    <select
                        className="h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 min-w-[180px]"
                        value={warehouseId}
                        onChange={(e) => setWarehouseId(e.target.value)}
                    >
                        <option value="">All Warehouses</option>
                        {warehouses.map((wh) => (
                            <option key={wh.id} value={wh.id}>{wh.name}</option>
                        ))}
                    </select>
                </div>
                {(categoryId || warehouseId) && (
                    <Button
                        text="Clear Filters"
                        size="small"
                        variant="tertiary"
                        onClick={() => { setCategoryId(''); setWarehouseId(''); }}
                    />
                )}
            </div>

            <Card padding={false}>
                <Table<StockValuationRow & Record<string, unknown>>
                    columns={columns}
                    data={rows as unknown as (StockValuationRow & Record<string, unknown>)[]}
                    isLoading={isLoading}
                    loadingLabel="Loading stock valuation..."
                    showCount
                    countLabel="items"
                />

                {/* Footer total */}
                {!isLoading && rows.length > 0 && (
                    <div className="flex justify-end items-center gap-3 px-4 py-3 border-t border-neutral-200 bg-neutral-50">
                        <span className="text-sm font-semibold text-neutral-700">Total Inventory Value:</span>
                        <span className="text-base font-bold text-primary-700">{formatIDR(totalValue)}</span>
                    </div>
                )}
            </Card>
        </ListPage>
    );
};

export default StockValuation;
