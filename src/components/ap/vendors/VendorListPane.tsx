// src/components/ap/vendors/VendorListPane.tsx
// Workspace-native Vendors catalog (flag-off stays views/ap/Vendors.tsx).
// Vendors have no separate detail — View/Edit open VendorForm as a tab.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Tags, Download } from 'lucide-react';
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
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer" onClick={() => navigate('/ap/vendor-categories')}><Tags size={16} />Vendor Categories</button>
                    {canCreate && <button className="border border-primary-700 bg-primary-700 text-neutral-0 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer" onClick={openNew}><Plus size={16} />Add Vendor</button>}
                    <button className="btn btn-secondary flex items-center gap-1" title="Export CSV" onClick={handleExportCsv}><Download size={16} /><span className="hidden sm:inline">Export</span></button>
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_220px] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400 pointer-events-none" />
                    <input type="text" className="block w-full pl-[34px] px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" placeholder="Search vendor #, name, or category..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" value={filters.category} onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value }))}>
                        <option value="">Filter by Category</option>
                        {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
                        <option value="">Filter by Status</option><option value="Active">Active</option><option value="Inactive">Inactive</option>
                    </select>
                </div>
            </div>

            <Card padding={false}>
                <Table columns={columns as TableColumn<Record<string, unknown>>[]} data={filteredData as unknown as Record<string, unknown>[]} onRowClick={(row) => openView(row['id'] as string)} showCount countLabel="vendors" isLoading={isLoading} loadingLabel="Loading vendors..." />
            </Card>
        </div>
    );
};

export default VendorListPane;
