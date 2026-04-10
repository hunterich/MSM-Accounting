import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import { formatIDR } from '../../utils/formatters';
import { useItems, useItemCategories } from '../../hooks/useInventory';
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
}

const Inventory = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('inv_items');
    const { data: itemsResult, isLoading } = useItems();
    const { data: itemCategories = [] } = useItemCategories();
    // API normalizer already computes stock, cost, price, and status
    const items = (itemsResult?.data ?? []) as InventoryItem[];

    const [searchTerm, setSearchTerm] = useState<string>('');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    const filteredItems = useMemo(() => {
        const keyword = searchTerm.toLowerCase();
        return items.filter((item) => {
            const matchesSearch =
                (item.sku || '').toLowerCase().includes(keyword) ||
                item.name.toLowerCase().includes(keyword) ||
                (item.category || '').toLowerCase().includes(keyword);
            const matchesCategory = categoryFilter ? item.categoryId === categoryFilter : true;
            const matchesStatus = statusFilter ? item.status === statusFilter : true;
            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [items, searchTerm, categoryFilter, statusFilter]);

    const statuses = useMemo(
        () => Array.from(new Set(items.map((item) => item.status))).sort(),
        [items]
    );

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
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
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
                <Button
                    text="Add Item"
                    variant="primary"
                    icon={<Plus size={16} />}
                    disabled={!canCreate}
                    onClick={() => navigate('/inventory/new')}
                />
            }
        >
            <div className="filter-bar filter-bar--3col">
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
            </Card>
        </ListPage>
    );
};

export default Inventory;
