// src/components/ap/vendors/VendorListPane.tsx
// Vendors catalog. The only Vendors list — the pre-workspace duplicate is gone.
// Vendors have no separate detail — View/Edit open VendorForm as a tab.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tags, Download } from 'lucide-react';
import FilterBar from '../../UI/FilterBar';
import PageHeader from '../../Layout/PageHeader';
import { exportToCsv } from '../../../utils/exportCsv';
import Button from '../../UI/Button';
import Card from '../../UI/Card';
import StatusTag from '../../UI/StatusTag';
import Table, { TableColumn } from '../../UI/Table';
import { formatIDR } from '../../../utils/formatters';
import { useVendorCategories, useVendors } from '../../../hooks/useAP';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';

const VendorListPane = (): React.ReactElement => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ap_vendors');
    const { open } = useWorkspaceNav();
    const { data: vendorsResult, isLoading } = useVendors();
    const { data: vendorCategories = [] } = useVendorCategories();
    const vendorList = useMemo(() => vendorsResult?.data ?? [], [vendorsResult?.data]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState<{ status: string; category: string }>({ status: '', category: '' });

    const labelFor = (id: string) => vendorList.find((v) => v.id === id)?.name || id;
    const openView = (id: string) => open({ kind: 'doc-form', target: { module: 'ap', entity: 'vendor', recordId: id, mode: 'view' }, title: labelFor(id), path: `/ap/vendors/new?vendorId=${id}&mode=view` });
    const openEdit = (id: string) => open({ kind: 'doc-form', target: { module: 'ap', entity: 'vendor', recordId: id, mode: 'edit' }, title: `Edit ${labelFor(id)}`, path: `/ap/vendors/edit?vendorId=${id}&mode=edit` });
    const openNew = () => open({ kind: 'doc-form', target: { module: 'ap', entity: 'vendor', recordId: null, mode: 'create' }, title: 'Add vendor', path: '/ap/vendors/new?mode=create', unique: true });

    const categoryOptions = useMemo(() => {
        const names = new Set((vendorCategories as Array<{ name: string }>).map((c) => c.name));
        vendorList.forEach((v) => { if (v.category) names.add(v.category); });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [vendorCategories, vendorList]);

    const filteredData = useMemo(() => vendorList.filter((v) => {
        const kw = searchTerm.toLowerCase();
        const matchesSearch = v.name.toLowerCase().includes(kw) || v.code.toLowerCase().includes(kw) || v.category.toLowerCase().includes(kw);
        const matchesStatus = filters.status ? v.status === filters.status : true;
        const matchesCategory = filters.category ? v.category === filters.category : true;
        return matchesSearch && matchesStatus && matchesCategory;
    }), [filters, searchTerm, vendorList]);

    const columns = [
        { key: 'code', label: 'Vendor #', sortable: true },
        { key: 'name', label: 'Vendor Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true, render: (val: unknown) => (val as string) || '—' },
        { key: 'paymentTerms', label: 'Terms', render: (val: unknown) => (val as string) || '—' },
        { key: 'balance', label: 'Open Balance', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="flex gap-1.5 justify-end">
                <Button text="View" size="small" variant="tertiary" onClick={() => openView(row['id'] as string)} />
                <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={() => openEdit(row['id'] as string)} />
            </div>
        ) },
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((v) => ({ code: v.code, name: v.name, category: v.category || '', paymentTerms: v.paymentTerms || '', balance: v.balance || 0, status: v.status }));
        exportToCsv('vendors.csv', rows, [
            { label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Category', key: 'category' },
            { label: 'Terms', key: 'paymentTerms' }, { label: 'Open Balance', key: 'balance' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ap-module container-full-width">
            <PageHeader
                title="Vendors"
                subtitle="Vendor master data, categories, and balances."
                actions={
                    <div className="flex gap-2">
                        <Button text="Vendor Categories" size="small" variant="tertiary" icon={<Tags size={16} />} onClick={() => navigate('/ap/vendor-categories')} />
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="Add Vendor" size="small" onClick={openNew} />}
                    </div>
                }
            />

            <FilterBar
                onSearch={setSearchTerm}
                filters={[
                    { key: 'category', label: 'Category', options: categoryOptions.map((c) => ({ value: c, label: c })) },
                    { key: 'status', label: 'Status', options: [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }] },
                ]}
                activeFilters={filters as unknown as Record<string, string>}
                onFilterChange={(key, val) => setFilters((p) => ({ ...p, [key]: val }))}
                placeholder="Search vendor #, name, or category..."
            />

            <Card padding={false}>
                <Table columns={columns as TableColumn<Record<string, unknown>>[]} data={filteredData as unknown as Record<string, unknown>[]} onRowClick={(row) => openView(row['id'] as string)} showCount countLabel="vendors" isLoading={isLoading} loadingLabel="Loading vendors..." />
            </Card>
        </div>
    );
};

export default VendorListPane;
