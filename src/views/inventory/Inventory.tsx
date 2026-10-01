import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import ListPage from '../../components/Layout/ListPage';
import { formatIDR } from '../../utils/formatters';
import { useItems, useItemCategories, fetchAllItems } from '../../hooks/useInventory';
import { useToastStore } from '../../stores/useToastStore';
import { useModulePermissions } from '../../hooks/useModulePermissions';

interface InventoryItem {
    id: string;
    sku?: string;
    name: string;
    category?: string;
    categoryId?: string;
    stock: number;
    cost: number;
    price: number;
    status: string;
    isActive: boolean;
}

const PAGE_SIZE = 50;

/** Status dropdown label → /items `stockStatus` param. */
const STOCK_STATUS_PARAM: Record<string, string> = {
    'In Stock': 'in',
    'Low Stock': 'low',
    'Out of Stock': 'out',
};

const Inventory = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('inv_items');
    const pushToast = useToastStore((s) => s.pushToast);

    const [searchTerm, setSearchTerm] = useState<string>('');
    const [debouncedSearch, setDebouncedSearch] = useState<string>('');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [activationFilter, setActivationFilter] = useState<string>('true');
    const [page, setPage] = useState<number>(1);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    useEffect(() => { setPage(1); }, [debouncedSearch, categoryFilter, statusFilter, activationFilter]);

    // Search, category, status, and paging all run server-side — the API pages
    // results, so filtering only the loaded page would hide most of the catalog.
    const listFilters = useMemo(() => {
        const f: Record<string, unknown> = {};
        if (debouncedSearch) f.search = debouncedSearch;
        if (categoryFilter) f.categoryId = categoryFilter;
        if (statusFilter) f.stockStatus = STOCK_STATUS_PARAM[statusFilter];
        f.isActive = activationFilter;
        return f;
    }, [debouncedSearch, categoryFilter, statusFilter, activationFilter]);
    const { data: itemsResult, isLoading } = useItems({ ...listFilters, page, limit: PAGE_SIZE });
    const { data: itemCategories = [] } = useItemCategories();
    // API normalizer already computes stock, cost, price, and status
    const filteredItems = (itemsResult?.data ?? []) as InventoryItem[];
    const total = itemsResult?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const [exporting, setExporting] = useState<boolean>(false);
    const handleExport = async (): Promise<void> => {
        setExporting(true);
        try {
            // Export every matching item, not just the page on screen.
            const all = (await fetchAllItems(listFilters)) as InventoryItem[];
            exportToCsv('inventory.csv', all.map((item) => ({
                sku: item.sku || '',
                name: item.name,
                category: item.category || '',
                stock: item.stock,
                cost: item.cost,
                price: item.price,
                status: item.status,
            })), [
                { label: 'SKU', key: 'sku' },
                { label: 'Item Name', key: 'name' },
                { label: 'Category', key: 'category' },
                { label: 'Stock', key: 'stock' },
                { label: 'Cost', key: 'cost' },
                { label: 'Price', key: 'price' },
                { label: 'Status', key: 'status' },
            ]);
        } catch (e) {
            pushToast(`Export failed: ${(e as Error).message}`, 'error');
        } finally {
            setExporting(false);
        }
    };

    const openItem = (row: InventoryItem, mode = 'view') => {
        navigate(`/inventory/new?mode=${mode}&itemId=${row.id}`, { state: { item: row } });
    };

    const columns = useMemo(() => ([
        { key: 'sku', label: 'SKU', sortable: true },
        { key: 'name', label: 'Item Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        {
            key: 'stock',
            label: 'Stock',
            align: 'right' as const,
            render: (val: unknown) => {
                const v = val as number;
                const className = v === 0 ? 'stock-danger' : v < 5 ? 'stock-warning' : 'stock-normal';
                return <span className={className}>{v}</span>;
            },
        },
        { key: 'cost', label: 'Cost', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'price', label: 'Price', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Stock', render: (val: unknown) => <StatusTag status={val as string} /> },
        { key: 'isActive', label: 'Item Status', render: (val: unknown) => <StatusTag status={(val as boolean) ? 'Active' : 'Inactive'} /> },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); openItem(row as unknown as InventoryItem, 'view'); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(event: React.MouseEvent) => { event.stopPropagation(); openItem(row as unknown as InventoryItem, 'edit'); }} />
                </div>
            )
        },
    ]), [navigate, canEdit]);

    return (
        <ListPage
            containerClassName="inventory-module"
            title="Inventory Management"
            subtitle="Track stock levels, costs, and pricing."
            actions={
                <div className="flex items-center gap-2">
                    <button
                        className="btn btn-secondary flex items-center gap-1"
                        title="Export CSV"
                        disabled={exporting}
                        onClick={() => { void handleExport(); }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
                    </button>
                    <Button
                        text="Add Item"
                        variant="primary"
                        icon={<Plus size={16} />}
                        disabled={!canCreate}
                        onClick={() => navigate('/inventory/new')}
                    />
                </div>
            }
        >
            <div className="filter-bar filter-bar--4col">
                <div className="filter-bar__search">
                    <Search size={18} />
                    <input
                        type="text"
                        className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                        placeholder="Search SKU, name, or category..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="filter-bar__field">
                    <select
                        className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                        <option value="">All Categories</option>
                        {(itemCategories as Array<{ id: string; name: string }>).map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                    </select>
                </div>

                <div className="filter-bar__field">
                    <select
                        aria-label="Item activation status"
                        className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                        value={activationFilter}
                        onChange={(e) => setActivationFilter(e.target.value)}
                    >
                        <option value="true">Active Items</option>
                        <option value="false">Inactive Items</option>
                        <option value="all">All Items</option>
                    </select>
                </div>

                <div className="filter-bar__field">
                    <select
                        className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="">All Statuses</option>
                        <option value="In Stock">In Stock</option>
                        <option value="Low Stock">Low Stock</option>
                        <option value="Out of Stock">Out of Stock</option>
                    </select>
                </div>
            </div>

            <Card padding={false}>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={filteredItems as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => openItem(row as unknown as InventoryItem, 'view')}
                    showCount
                    countLabel="items"
                    isLoading={isLoading}
                    loadingLabel="Loading inventory items..."
                />
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-200 text-sm">
                        <span className="text-neutral-500">{total.toLocaleString()} items total</span>
                        <div className="flex gap-2">
                            <button
                                className="px-2 py-1 rounded border border-neutral-300 text-neutral-700 disabled:opacity-40"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                Previous
                            </button>
                            <span className="px-2 py-1 text-neutral-600">{page} / {totalPages}</span>
                            <button
                                className="px-2 py-1 rounded border border-neutral-300 text-neutral-700 disabled:opacity-40"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </Card>
        </ListPage>
    );
};

export default Inventory;
