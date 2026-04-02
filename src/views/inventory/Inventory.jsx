import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import { formatIDR } from '../../utils/formatters';
import { useItems, useItemCategories } from '../../hooks/useInventory';
import { useModulePermissions } from '../../hooks/useModulePermissions';


const Inventory = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('inv_items');
    const { data: itemsResult, isLoading } = useItems();
    const { data: itemCategories = [] } = useItemCategories();
    // API normalizer already computes stock, cost, price, and status
    const items = itemsResult?.data ?? [];

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

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

    const openItem = (row, mode = 'view') => {
        navigate(`/inventory/new?mode=${mode}&itemId=${row.id}`, { state: { item: row } });
    };

    const columns = useMemo(() => ([
        { key: 'sku', label: 'SKU', sortable: true },
        { key: 'name', label: 'Item Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        {
            key: 'stock',
            label: 'Stock',
            align: 'right',
            render: (val) => {
                const className = val === 0 ? 'stock-danger' : val < 5 ? 'stock-warning' : 'stock-normal';
                return <span className={className}>{val}</span>;
            },
        },
        { key: 'cost', label: 'Cost', align: 'right', render: (val) => formatIDR(val) },
        { key: 'price', label: 'Price', align: 'right', render: (val) => formatIDR(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); openItem(row, 'view'); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(event) => { event.stopPropagation(); openItem(row, 'edit'); }} />
                </div>
            )
        },
    ]), [navigate]);

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
                        {itemCategories.map((cat) => (
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
                    columns={columns}
                    data={filteredItems}
                    onRowClick={(row) => openItem(row, 'view')}
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
