import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import { formatIDR } from '../../utils/formatters';
import { useInventoryStore } from '../../stores/useInventoryStore';

// Derive stock status label from qty on hand
const getStockStatus = (stock) => {
    if (stock === 0) return 'Out of Stock';
    if (stock < 5) return 'Low Stock';
    return 'In Stock';
};

const Inventory = () => {
    const navigate = useNavigate();
    const rawProducts = useInventoryStore((s) => s.products);

    // Normalise products — add computed status and ensure numeric fields
    const items = useMemo(() =>
        rawProducts.map((p) => ({
            ...p,
            stock: Number(p.openingStock ?? p.stock ?? 0),
            cost: Number(p.cost) || 0,
            price: Number(p.price) || 0,
            status: getStockStatus(Number(p.openingStock ?? p.stock ?? 0)),
        })),
        [rawProducts]
    );

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const categories = useMemo(
        () => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort(),
        [items]
    );

    const statuses = useMemo(
        () => Array.from(new Set(items.map((item) => item.status))).sort(),
        [items]
    );

    const filteredItems = useMemo(() => {
        const keyword = searchTerm.toLowerCase();
        return items.filter((item) => {
            const matchesSearch =
                item.id.toLowerCase().includes(keyword) ||
                item.name.toLowerCase().includes(keyword) ||
                item.category.toLowerCase().includes(keyword);
            const matchesCategory = categoryFilter ? item.category === categoryFilter : true;
            const matchesStatus = statusFilter ? item.status === statusFilter : true;
            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [items, searchTerm, categoryFilter, statusFilter]);

    const openItem = (row, mode = 'view') => {
        navigate(`/inventory/new?mode=${mode}&itemId=${row.id}`, { state: { item: row } });
    };

    const columns = useMemo(() => ([
        { key: 'id', label: 'SKU', sortable: true },
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
                    <Button text="Edit" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); openItem(row, 'edit'); }} />
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
                        {categories.map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
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
                        {statuses.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
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
                />
            </Card>
        </ListPage>
    );
};

export default Inventory;
