import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search, List } from 'lucide-react';
import { formatIDR } from '../../utils/formatters';
import { useVendors } from '../../hooks/useAP';
import { useModulePermissions } from '../../hooks/useModulePermissions';

const Vendors = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ap_vendors');
    const { data: vendorsResult, isLoading } = useVendors();
    const vendorList = vendorsResult?.data ?? [];
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ status: '', category: '' });
    const categories = useMemo(() => Array.from(new Set(vendorList.map((vendor) => vendor.category).filter(Boolean))).sort(), [vendorList]);

    const filteredData = useMemo(() => {
        return vendorList.filter((item) => {
            const matchesSearch =
                item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (item.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (item.code || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filters.status ? item.status === filters.status : true;
            const matchesCategory = filters.category ? item.category === filters.category : true;
            return matchesSearch && matchesStatus && matchesCategory;
        });
    }, [searchTerm, filters]);

    const columns = [
        { key: 'code', label: 'Vendor #' },
        { key: 'name', label: 'Vendor Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        { key: 'balance', label: 'Open Balance', align: 'right', render: (val) => formatIDR(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <div className="flex gap-1.5 justify-end">
                    <Button text="View" size="small" variant="tertiary" onClick={() => navigate(`/ap/vendors/new?vendorId=${row.id}&mode=view`)} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={() => navigate(`/ap/vendors/edit?vendorId=${row.id}&mode=edit`)} />
                </div>
            )
        }
    ];

    return (
        <div className="max-w-full mx-auto">
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    <button
                        className="border border-[#b9ddff] bg-[#e8f4ff] text-primary-700 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => {
                            setSearchTerm('');
                            setFilters({ status: '', category: '' });
                        }}
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    <button
                        className={`border border-primary-700 bg-primary-700 text-neutral-0 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold ${canCreate ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                        onClick={() => navigate('/ap/vendors/new?mode=create')}
                        disabled={!canCreate}
                    >
                        <Plus size={16} />
                        Add Vendor
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_220px] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400 pointer-events-none" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search vendor #, name, or category..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.category}
                        onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}
                    >
                        <option value="">Filter by Category</option>
                        {categories.map((category) => (
                            <option key={category} value={category}>{category}</option>
                        ))}
                    </select>
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.status}
                        onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                    >
                        <option value="">Filter by Status</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                    </select>
                </div>
            </div>

            <Card padding={false}>
                <Table
                    columns={columns}
                    data={filteredData}
                    onRowClick={(row) => navigate(`/ap/vendors/new?vendorId=${row.id}&mode=view`)}
                    showCount
                    countLabel="vendors"
                    isLoading={isLoading}
                    loadingLabel="Loading vendors..."
                />
            </Card>
        </div>
    );
};

export default Vendors;
