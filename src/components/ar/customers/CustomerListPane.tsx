// src/components/ar/customers/CustomerListPane.tsx
//
// Workspace-native customer catalog. Mirrors InvoiceListPane: the table opens a
// per-customer doc-view tab, "New" opens a doc-form tab. Only rendered when the
// workspace-tabs flag is on (the flag-off path stays src/views/ar/Customers.tsx).
import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { exportToCsv } from '../../../utils/exportCsv';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import FilterBar from '../../UI/FilterBar';
import PageHeader from '../../Layout/PageHeader';
import { formatIDR } from '../../../utils/formatters';
import { useCustomers } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface CustomerFilters { category: string; status: string }

const CustomerListPane = (): React.ReactElement => {
    const { canCreate, canEdit } = useModulePermissions('ar_customers');
    const { open } = useWorkspaceNav();
    const { data: cuResult, isLoading } = useCustomers();
    const customerList = useMemo(() => cuResult?.data ?? [], [cuResult?.data]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState<CustomerFilters>({ category: '', status: '' });

    const filteredData = useMemo(() => customerList.filter((item) => {
        const keyword = searchTerm.toLowerCase();
        const matchesSearch = item.name.toLowerCase().includes(keyword) || item.email.toLowerCase().includes(keyword);
        const matchesCategory = filters.category ? item.category === filters.category : true;
        const matchesStatus = filters.status ? item.status === filters.status : true;
        return matchesSearch && matchesCategory && matchesStatus;
    }), [customerList, searchTerm, filters]);

    const labelFor = (id: string) => customerList.find((c) => c.id === id)?.name || id;

    const openView = (id: string) => open({
        kind: 'doc-view',
        target: { module: 'ar', entity: 'customer', recordId: id, mode: 'view' },
        title: labelFor(id),
        path: `/ar/customers?id=${id}`,
    });
    const openEdit = (id: string) => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'customer', recordId: id, mode: 'edit' },
        title: `Edit ${labelFor(id)}`,
        path: `/ar/customers/edit?id=${id}&mode=edit`,
    });
    const openNew = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'customer', recordId: null, mode: 'create' },
        title: 'New customer',
        path: '/ar/customers/new',
        unique: true,
    });

    const filterOptions = [
        { key: 'category', label: 'Filter by Category', options: [
            { value: 'Wholesale', label: 'Wholesale' }, { value: 'Retail', label: 'Retail' },
            { value: 'Distributor', label: 'Distributor' }, { value: 'VIP', label: 'VIP' } ] },
        { key: 'status', label: 'Filter by Status', options: [
            { value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' } ] },
    ];

    const columns = [
        { key: 'name', label: 'Company Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        { key: 'defaultDiscount', label: 'Discount', align: 'right' as const, render: (val: unknown) => `${val}%` },
        { key: 'paymentTerms', label: 'Terms', align: 'right' as const, render: (val: unknown) => (val === 0 ? 'Due on Receipt' : `Net ${val}`) },
        { key: 'balance', label: 'Open Balance', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEdit(row['id'] as string); }} /> },
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((c) => ({
            code: c.id, name: c.name, category: c.category || '',
            defaultDiscount: c.defaultDiscount || 0,
            paymentTerms: c.paymentTerms === 0 ? 'Due on Receipt' : `Net ${c.paymentTerms}`,
            balance: c.balance || 0, status: c.status,
        }));
        exportToCsv('customers.csv', rows, [
            { label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Category', key: 'category' },
            { label: 'Discount', key: 'defaultDiscount' }, { label: 'Terms', key: 'paymentTerms' },
            { label: 'Open Balance', key: 'balance' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Customers"
                subtitle="Customer master data, credit terms, and balances."
                actions={
                    <div className="flex gap-2">
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="New Customer" size="small" onClick={openNew} />}
                    </div>
                }
            />
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
                    onRowClick={(row) => openView(row['id'] as string)}
                    showCount
                    countLabel="customers"
                    isLoading={isLoading}
                    loadingLabel="Loading customers..."
                />
            </Card>
        </div>
    );
};

export default CustomerListPane;
