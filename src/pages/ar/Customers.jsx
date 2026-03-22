import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Plus, X, User, MapPin, Clock3, History } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import FilterBar from '../../components/UI/FilterBar';
import { formatIDR } from '../../utils/formatters';
import { useCustomers } from '../../hooks/useAR';
import { Loader } from 'lucide-react';

const MAX_TABS_PER_ROW = 5;

const Customers = () => {
    const navigate = useNavigate();
    const { data: cuResult, isLoading } = useCustomers();
    const customerList = cuResult?.data ?? [];
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ category: '', status: '' });
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [openCustomerIds, setOpenCustomerIds] = useState([]);
    const [detailTab, setDetailTab] = useState('summary');
    const [masterCreditLimit] = useState(5000000); // Fixed typo from 5000 to 5m for realism

    const filteredData = useMemo(() => {
        return customerList.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            const matchesSearch = item.name.toLowerCase().includes(keyword) || item.email.toLowerCase().includes(keyword);
            const matchesCategory = filters.category ? item.category === filters.category : true;
            const matchesStatus = filters.status ? item.status === filters.status : true;
            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [customerList, searchTerm, filters]);

    const selectedCustomer = customerList.find((c) => c.id === selectedCustomerId) || null;

    const openCustomerTab = (customerId) => {
        setOpenCustomerIds((prev) => (prev.includes(customerId) ? prev : [...prev, customerId]));
        setSelectedCustomerId(customerId);
        setDetailTab('summary');
    };

    const closeCustomerTab = (customerId) => {
        setOpenCustomerIds((prev) => {
            const idx = prev.indexOf(customerId);
            const next = prev.filter((id) => id !== customerId);
            if (selectedCustomerId === customerId) {
                if (next.length === 0) {
                    setSelectedCustomerId('');
                } else {
                    setSelectedCustomerId(next[Math.max(0, idx - 1)] || next[0]);
                }
            }
            return next;
        });
    };

    const handleNewCustomer = () => {
        navigate('/ar/customers/new');
    };

    const handleEditCustomer = (id) => {
        navigate(`/ar/customers/edit?id=${id}&mode=edit`);
    };

    const filterOptions = [
        {
            key: 'category',
            label: 'Filter by Category',
            options: [
                { value: 'Wholesale', label: 'Wholesale' },
                { value: 'Retail', label: 'Retail' },
                { value: 'Distributor', label: 'Distributor' },
                { value: 'VIP', label: 'VIP' }
            ]
        },
        {
            key: 'status',
            label: 'Filter by Status',
            options: [
                { value: 'Active', label: 'Active' },
                { value: 'Inactive', label: 'Inactive' }
            ]
        }
    ];

    const columns = [
        { key: 'name', label: 'Company Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        { key: 'defaultDiscount', label: 'Discount', align: 'right', render: (val) => `${val}%` },
        { key: 'paymentTerms', label: 'Terms', align: 'right', render: (val) => (val === 0 ? 'Due on Receipt' : `Net ${val}`) },
        { key: 'balance', label: 'Open Balance', align: 'right', render: (val) => formatIDR(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val} /> },
        { key: 'actions', label: '', render: (_, row) => <Button text="Edit" size="small" variant="tertiary" onClick={(e) => { e.stopPropagation(); handleEditCustomer(row.id); }} /> }
    ];

    const firstRowDynamicLimit = Math.max(0, MAX_TABS_PER_ROW - 2);
    const firstRowIds = openCustomerIds.slice(0, firstRowDynamicLimit);
    const remainingIds = openCustomerIds.slice(firstRowDynamicLimit);
    const extraRows = [];
    for (let i = 0; i < remainingIds.length; i += MAX_TABS_PER_ROW) {
        extraRows.push(remainingIds.slice(i, i + MAX_TABS_PER_ROW));
    }

    const renderCustomerTab = (customerId) => {
        const customer = customerList.find((c) => c.id === customerId);
        if (!customer) return null;
        const isActive = selectedCustomerId === customerId;
        return (
            <button
                key={customerId}
                className={`border bg-neutral-100 text-neutral-800 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer ${isActive ? 'bg-neutral-0 border-neutral-300 border-b-neutral-0' : 'border-neutral-300'}`}
                onClick={() => setSelectedCustomerId(customerId)}
            >
                {customer.name}
                <span className="inline-flex items-center text-neutral-600" onClick={(e) => { e.stopPropagation(); closeCustomerTab(customerId); }}>
                    <X size={14} />
                </span>
            </button>
        );
    };

    return (
        <div className="max-w-full mx-auto">
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    <button className="border border-[#b9ddff] bg-[#e8f4ff] text-primary-700 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer" onClick={() => setSelectedCustomerId('')}>
                        <List size={16} />
                        Catalog
                    </button>
                    <button className="border border-primary-700 bg-primary-700 text-neutral-0 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer" onClick={handleNewCustomer}>
                        <Plus size={16} />
                        New Customer
                    </button>
                    {firstRowIds.map((id) => renderCustomerTab(id))}
                    <div className="ml-auto text-[0.82rem] text-neutral-600 font-semibold pr-1">Open tabs: {openCustomerIds.length}</div>
                </div>
                {extraRows.map((row, rowIdx) => (
                    <div key={`customer-row-${rowIdx}`} className="flex gap-1.5 flex-nowrap items-center">
                        {row.map((id) => renderCustomerTab(id))}
                    </div>
                ))}
            </div>

            {!selectedCustomer && (
                <>
                    <FilterBar
                        onSearch={setSearchTerm}
                        filters={filterOptions}
                        activeFilters={filters}
                        onFilterChange={(key, val) => setFilters((prev) => ({ ...prev, [key]: val }))}
                        placeholder="Search by name or email..."
                    />
                    <Card padding={false}>
                        {isLoading ? (
                            <div className="flex items-center gap-2 py-8 px-4 text-sm text-neutral-400">
                                <Loader size={16} className="animate-spin" /> Loading customers…
                            </div>
                        ) : (
                            <Table
                                columns={columns}
                                data={filteredData}
                                onRowClick={(row) => openCustomerTab(row.id)}
                                showCount
                                countLabel="customers"
                            />
                        )}
                    </Card>
                </>
            )}

            {selectedCustomer && (
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between py-2.5 px-3 border-b border-[#d7dbe0]">
                        <div className="flex items-center gap-2.5">
                            <h2 className="m-0 text-xl font-semibold">{selectedCustomer.name}</h2>
                            <StatusTag status={selectedCustomer.status} />
                        </div>
                        <div className="flex gap-2">
                            <Button text="Edit" size="small" variant="primary" onClick={() => handleEditCustomer(selectedCustomer.id)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 py-2.5 px-3 border-b border-[#d7dbe0]">
                        <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                            <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Email</label>
                            <div className="text-base font-semibold">{selectedCustomer.email || '-'}</div>
                        </div>
                        <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                            <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Category</label>
                            <div className="text-base font-semibold">{selectedCustomer.category || '-'}</div>
                        </div>
                        <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                            <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Payment Terms</label>
                            <div className="text-base font-semibold">{selectedCustomer.paymentTerms === 0 ? 'Due on Receipt' : `Net ${selectedCustomer.paymentTerms}`}</div>
                        </div>
                        <div className="border border-[#d7dbe0] rounded-md py-1.5 px-2 min-h-14">
                            <label className="block text-neutral-600 text-[0.74rem] mb-0.5">Default Discount</label>
                            <div className="text-base font-semibold">{selectedCustomer.defaultDiscount || 0}%</div>
                        </div>
                        <div className="col-span-4 text-right text-[1.4rem] font-bold text-primary-700 pr-0.5">{formatIDR(selectedCustomer.balance || 0)}</div>
                    </div>

                    <div className="grid grid-cols-[1fr_56px] items-stretch">
                        <div className="min-w-0">
                            <div className="flex gap-1 border-b border-neutral-200 px-2 pt-2">
                                <button className={`border border-transparent border-b-2 border-b-transparent bg-transparent text-neutral-600 py-2 px-2.5 cursor-pointer font-semibold text-[0.85rem] ${detailTab === 'summary' ? '!text-primary-700 !border-b-primary-600' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                                <button className={`border border-transparent border-b-2 border-b-transparent bg-transparent text-neutral-600 py-2 px-2.5 cursor-pointer font-semibold text-[0.85rem] ${detailTab === 'terms' ? '!text-primary-700 !border-b-primary-600' : ''}`} onClick={() => setDetailTab('terms')}>Terms</button>
                                <button className={`border border-transparent border-b-2 border-b-transparent bg-transparent text-neutral-600 py-2 px-2.5 cursor-pointer font-semibold text-[0.85rem] ${detailTab === 'address' ? '!text-primary-700 !border-b-primary-600' : ''}`} onClick={() => setDetailTab('address')}>Address</button>
                                <button className={`border border-transparent border-b-2 border-b-transparent bg-transparent text-neutral-600 py-2 px-2.5 cursor-pointer font-semibold text-[0.85rem] ${detailTab === 'activity' ? '!text-primary-700 !border-b-primary-600' : ''}`} onClick={() => setDetailTab('activity')}>Activity</button>
                            </div>
                            <div className="p-2.5">
                                {detailTab === 'summary' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Name</label><strong>{selectedCustomer.name}</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Status</label><StatusTag status={selectedCustomer.status} /></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Email</label><div>{selectedCustomer.email || '-'}</div></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Open Balance</label><strong>{formatIDR(selectedCustomer.balance || 0)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'terms' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Payment Terms</label><strong>{selectedCustomer.paymentTerms === 0 ? 'Due on Receipt' : `Net ${selectedCustomer.paymentTerms}`}</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Default Discount</label><strong>{selectedCustomer.defaultDiscount || 0}%</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Credit Limit Source</label><strong>Master Setting ({formatIDR(masterCreditLimit)})</strong></div>
                                    </div>
                                )}
                                {detailTab === 'address' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Billing Address</label><div>{selectedCustomer.billingAddress || '-'}</div></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Shipping Address</label><div>{selectedCustomer.shippingAddress || '-'}</div></div>
                                    </div>
                                )}
                                {detailTab === 'activity' && (
                                    <ul className="list-none m-0 p-0">
                                        <li className="border border-neutral-200 rounded-lg py-2 px-2.5 mb-2 text-[0.88rem]">
                                            <div><strong>Customer created</strong></div>
                                            <div>2026-02-01 • Admin</div>
                                        </li>
                                        <li className="border border-neutral-200 rounded-lg py-2 px-2.5 mb-2 text-[0.88rem]">
                                            <div><strong>Last invoice generated</strong></div>
                                            <div>2026-02-10 • System</div>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        </div>
                        <div className="border-l border-[#d7dbe0] flex flex-col gap-2 items-center py-2.5 px-2 bg-[#fafbfc]">
                            <button className="w-[38px] h-[38px] rounded-lg border border-[#c6d4e3] bg-[#e9f3ff] text-[#1967b2] inline-flex items-center justify-center cursor-pointer" title="Summary"><User size={18} /></button>
                            <button className="w-[38px] h-[38px] rounded-lg border border-[#c6d4e3] bg-[#e9f3ff] text-[#1967b2] inline-flex items-center justify-center cursor-pointer" title="Address"><MapPin size={18} /></button>
                            <button className="w-[38px] h-[38px] rounded-lg border border-[#8cd3a1] bg-[#d7f4df] text-[#1d7f3e] inline-flex items-center justify-center cursor-pointer" title="Terms"><Clock3 size={18} /></button>
                            <button className="w-[38px] h-[38px] rounded-lg border border-[#f0b5b5] bg-[#ffe2e2] text-[#c43a3a] inline-flex items-center justify-center cursor-pointer" title="Activity"><History size={18} /></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Customers;
