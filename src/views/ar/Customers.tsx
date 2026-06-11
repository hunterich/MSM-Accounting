import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, MapPin, Clock3, History, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import FilterBar from '../../components/UI/FilterBar';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import { formatIDR } from '../../utils/formatters';
import { useCustomers } from '../../hooks/useAR';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface CustomerFilters {
    category: string;
    status: string;
}

const Customers = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ar_customers');
    const { data: cuResult, isLoading } = useCustomers();
    const masterCreditSettings = useSettingsStore((state) => state.customerCreditSettings);
    const customerList = cuResult?.data ?? [];
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<CustomerFilters>({ category: '', status: '' });
    const {
        selectedId: selectedCustomerId,
        openIds: openCustomerIds,
        openTab,
        closeTab: closeCustomerTab,
        selectNone,
        tabRows,
    } = useDocumentTabs({ maxPerRow: 5 });
    const [detailTab, setDetailTab] = useState<string>('summary');
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

    const openCustomerTab = (customerId: string) => {
        openTab(customerId);
        setDetailTab('summary');
    };

    const handleNewCustomer = () => {
        navigate('/ar/customers/new');
    };

    const handleEditCustomer = (id: string) => {
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
        { key: 'defaultDiscount', label: 'Discount', align: 'right' as const, render: (val: unknown) => `${val}%` },
        { key: 'paymentTerms', label: 'Terms', align: 'right' as const, render: (val: unknown) => (val === 0 ? 'Due on Receipt' : `Net ${val}`) },
        { key: 'balance', label: 'Open Balance', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleEditCustomer(row['id'] as string); }} /> }
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((c) => ({
            code: c.id,
            name: c.name,
            category: c.category || '',
            defaultDiscount: c.defaultDiscount || 0,
            paymentTerms: c.paymentTerms === 0 ? 'Due on Receipt' : `Net ${c.paymentTerms}`,
            balance: c.balance || 0,
            status: c.status,
        }));
        exportToCsv('customers.csv', rows, [
            { label: 'Code', key: 'code' },
            { label: 'Name', key: 'name' },
            { label: 'Category', key: 'category' },
            { label: 'Discount', key: 'defaultDiscount' },
            { label: 'Terms', key: 'paymentTerms' },
            { label: 'Open Balance', key: 'balance' },
            { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Customers"
                subtitle="Customer master data, credit terms, and balances."
                actions={
                    <Button
                        text="Export CSV"
                        size="small"
                        variant="secondary"
                        icon={<Download size={16} />}
                        onClick={handleExportCsv}
                    />
                }
            />

            <DocumentTabBar
                openIds={openCustomerIds}
                selectedId={selectedCustomerId}
                tabRows={tabRows}
                getLabel={(id) => customerList.find((c) => c.id === id)?.name || id}
                onSelect={openCustomerTab}
                onClose={closeCustomerTab}
                newTabLabel="New Customer"
                onNewTab={canCreate ? handleNewCustomer : undefined}
                disableNew={!canCreate}
                onCatalog={selectNone}
                firstRowSuffix={
                    <div className="workbench-tab-count">Open tabs: {openCustomerIds.length}</div>
                }
            />

            {!selectedCustomer && (
                <>
                    <FilterBar
                        onSearch={setSearchTerm}
                        filters={filterOptions}
                        activeFilters={filters as unknown as Record<string, string>}
                        onFilterChange={(key, val) => setFilters((prev) => ({ ...prev, [key]: val }))}
                        placeholder="Search by name or email..."
                    />
                    <Card padding={false}>
                        <Table
                            columns={columns as TableColumn<Record<string, unknown>>[]}
                            data={filteredData as unknown as Record<string, unknown>[]}
                            onRowClick={(row) => openCustomerTab(row['id'] as string)}
                            showCount
                            countLabel="customers"
                            isLoading={isLoading}
                            loadingLabel="Loading customers..."
                        />
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
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => handleEditCustomer(selectedCustomer.id)} />
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
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Name</label><strong>{selectedCustomer.name}</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Status</label><StatusTag status={selectedCustomer.status} /></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Email</label><div>{selectedCustomer.email || '-'}</div></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Open Balance</label><strong>{formatIDR(selectedCustomer.balance || 0)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'terms' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Payment Terms</label><strong>{selectedCustomer.paymentTerms === 0 ? 'Due on Receipt' : `Net ${selectedCustomer.paymentTerms}`}</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Default Discount</label><strong>{selectedCustomer.defaultDiscount || 0}%</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Credit Limit</label><strong>{formatIDR(selectedCustomer.creditLimit || 0)}</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5"><label className="block text-[0.78rem] text-neutral-600 mb-1">Master Payment Terms</label><strong>{masterCreditSettings.defaultPaymentTerms === 0 ? 'Due on Receipt' : `Net ${masterCreditSettings.defaultPaymentTerms}`}</strong></div>
                                        <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2"><label className="block text-[0.78rem] text-neutral-600 mb-1">Master Credit Limit</label><strong>{formatIDR(masterCreditSettings.defaultLimit || 0)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'address' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
