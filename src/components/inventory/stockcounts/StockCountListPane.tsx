// src/components/inventory/stockcounts/StockCountListPane.tsx
// Stock-count catalog. The only such list — the pre-workspace duplicate is gone.
import React, { useMemo, useState } from 'react';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PageHeader from '../../Layout/PageHeader';
import FilterBar from '../../UI/FilterBar';
import { formatDateID } from '../../../utils/formatters';
import { useStockCounts, useItemCategories, useWarehouses, type StockCount } from '../../../hooks/useInventory';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { countStatusTag } from './stockCountStatus';

const StockCountListPane = (): React.ReactElement => {
    const { canCreate } = useModulePermissions('inv_adj');
    const { open } = useWorkspaceNav();
    const { data: countsRes, isLoading } = useStockCounts();
    const counts = useMemo<StockCount[]>(() => countsRes?.data ?? [], [countsRes?.data]);
    const { data: categories = [] } = useItemCategories();
    const { data: warehouses = [] } = useWarehouses();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const scopeLabel = (count: StockCount): string => {
        const parts: string[] = [];
        if (count.categoryId) { const cat = categories.find((c) => c.id === count.categoryId); if (cat) parts.push(cat.name); }
        if (count.warehouseId) { const wh = warehouses.find((w) => w.id === count.warehouseId); if (wh) parts.push(wh.name); }
        return parts.length ? parts.join(' / ') : 'All';
    };

    const openView = (id: string) => { const c = counts.find((x) => x.id === id); open({ kind: 'doc-view', target: { module: 'stock-count', entity: 'count', recordId: id, mode: 'view' }, title: c?.number ?? id, path: `/inventory/counts?countId=${id}` }); };
    const openWorksheet = (id: string) => { const c = counts.find((x) => x.id === id); open({ kind: 'doc-form', target: { module: 'stock-count', entity: 'count', recordId: id, mode: 'edit' }, title: `Worksheet ${c?.number ?? id}`, path: `/inventory/counts/edit?id=${id}` }); };
    const openNew = () => open({ kind: 'doc-form', target: { module: 'stock-count', entity: 'count', recordId: null, mode: 'create' }, title: 'New count', path: '/inventory/counts/new', unique: true });

    const filteredCounts = useMemo(() => {
        const kw = searchTerm.toLowerCase();
        return counts.filter((c) => (!kw || c.number.toLowerCase().includes(kw)) && (!statusFilter || c.status === statusFilter));
    }, [counts, searchTerm, statusFilter]);

    const columns = useMemo((): TableColumn<Record<string, unknown>>[] => [
        { key: 'number', label: 'Number', render: (val) => <span className="font-medium text-primary-700">{val as string}</span> },
        { key: 'date', label: 'Date', render: (val) => formatDateID(val as string) },
        { key: 'id', label: 'Scope', render: (_val, row) => scopeLabel(row as unknown as StockCount) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag {...countStatusTag(val as string)} /> },
        { key: '_count', label: 'Items', align: 'right' as const, render: (val) => (val as { lines?: number } | undefined)?.lines ?? 0 },
        { key: 'actions', label: '', render: (_val, row) => {
            const r = row as unknown as StockCount;
            if (r.status !== 'DRAFT' && r.status !== 'SUBMITTED') return null;
            return <div className="row-actions-end"><Button text="Open worksheet" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openWorksheet(r.id); }} /></div>;
        } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [categories, warehouses, counts]);

    return (
        <div className="container banking-module container-full-width">
            <PageHeader
                title="Stock Counts"
                subtitle="Count physical stock and post the variances."
                actions={canCreate ? <Button text="New count" size="small" onClick={openNew} /> : undefined}
            />
            <FilterBar
                onSearch={setSearchTerm}
                filters={[{
                    key: 'status',
                    label: 'Status',
                    options: [
                        { value: 'DRAFT', label: 'Draft' },
                        { value: 'SUBMITTED', label: 'Submitted' },
                        { value: 'POSTED', label: 'Posted' },
                        { value: 'CANCELLED', label: 'Cancelled' },
                        { value: 'VOIDED', label: 'Voided' },
                    ],
                }]}
                activeFilters={{ status: statusFilter }}
                onFilterChange={(_key, val) => setStatusFilter(val)}
                placeholder="Search by number..."
            />
            <Card padding={false}>
                <Table
                    columns={columns}
                    data={filteredCounts as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => openView((row as unknown as StockCount).id)}
                    showCount countLabel="counts" isLoading={isLoading} loadingLabel="Loading stock counts…"
                />
            </Card>
        </div>
    );
};

export default StockCountListPane;
