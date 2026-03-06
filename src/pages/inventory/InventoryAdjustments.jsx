import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search, List } from 'lucide-react';
import { formatDateID } from '../../utils/formatters';
import { useInventoryStore } from '../../stores/useInventoryStore';

const InventoryAdjustments = () => {
    const navigate = useNavigate();
    const adjustments = useInventoryStore((s) => s.adjustments);

    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ status: '', type: '' });
    const [dateRange, setDateRange] = useState({ from: '', to: '' });

    const filteredData = useMemo(() => {
        return adjustments.filter((item) => {
            const matchesSearch =
                item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.reason.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filters.status ? item.status === filters.status : true;
            const matchesType = filters.type ? item.type === filters.type : true;

            let matchesDate = true;
            if (dateRange.from) {
                matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
            }
            if (dateRange.to) {
                matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
            }

            return matchesSearch && matchesStatus && matchesType && matchesDate;
        });
    }, [adjustments, searchTerm, filters.status, filters.type, dateRange.from, dateRange.to]);

    const columns = [
        { key: 'id', label: 'Reference No.', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'type', label: 'Type' },
        { key: 'reason', label: 'Reason' },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Approved' ? 'Success' : val} label={val} /> },
        {
            key: 'actions', label: '', render: (_, row) => (
                <div className="flex gap-1.5 justify-end">
                    <Button text="View" size="small" variant="tertiary" onClick={() => navigate(`/inventory/adjustments/edit?id=${row.id}&mode=view`)} />
                    <Button text="Edit" size="small" variant="tertiary" onClick={() => navigate(`/inventory/adjustments/edit?id=${row.id}&mode=edit`)} />
                </div>
            )
        }
    ];

    return (
        <div className="max-w-full mx-auto">
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    <button
                        className="border border-[#b9ddff] bg-[#e8f4ff] text-primary-700 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => {
                            setSearchTerm('');
                            setFilters({ status: '', type: '' });
                            setDateRange({ from: '', to: '' });
                        }}
                    >
                        <List size={16} />
                        Adjustments
                    </button>
                    <button
                        className="border border-primary-700 bg-primary-700 text-neutral-0 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => navigate('/inventory/adjustments/new')}
                    >
                        <Plus size={16} />
                        New Adjustment
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_170px_170px_150px_150px_auto] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search reference or reason..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.type}
                        onChange={(event) => setFilters(prev => ({ ...prev, type: event.target.value }))}
                    >
                        <option value="">Filter by Type</option>
                        <option value="Quantity">Quantity</option>
                        <option value="Value">Value</option>
                    </select>
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.status}
                        onChange={(event) => setFilters(prev => ({ ...prev, status: event.target.value }))}
                    >
                        <option value="">Filter by Status</option>
                        <option value="Draft">Draft</option>
                        <option value="Approved">Approved</option>
                    </select>
                </div>
                <div className="min-w-0">
                    <input
                        type="date"
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={dateRange.from}
                        onChange={(event) => setDateRange((prev) => ({ ...prev, from: event.target.value }))}
                    />
                </div>
                <div className="min-w-0">
                    <input
                        type="date"
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={dateRange.to}
                        onChange={(event) => setDateRange((prev) => ({ ...prev, to: event.target.value }))}
                    />
                </div>
                {(dateRange.from || dateRange.to) && (
                    <Button
                        text="Clear"
                        variant="tertiary"
                        size="small"
                        className="justify-self-end"
                        onClick={() => setDateRange({ from: '', to: '' })}
                    />
                )}
            </div>

            <Card padding={false}>
                <Table
                    columns={columns}
                    data={filteredData}
                    onRowClick={(row) => navigate(`/inventory/adjustments/edit?id=${row.id}&mode=view`)}
                    showCount
                    countLabel="adjustments"
                />
            </Card>
        </div>
    );
};

export default InventoryAdjustments;
