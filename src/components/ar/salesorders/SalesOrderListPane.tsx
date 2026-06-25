// src/components/ar/salesorders/SalesOrderListPane.tsx
import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import SOCatalogPanel from './SOCatalogPanel';
import PageHeader from '../../Layout/PageHeader';
import Button from '../../UI/Button';
import { useSalesOrders } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface SOFilters { searchTerm: string; status: string; dateFrom: string; dateTo: string }

const SalesOrderListPane = (): React.ReactElement => {
    const { canCreate, canEdit } = useModulePermissions('ar_sales_orders');
    const { open } = useWorkspaceNav();
    const { data: soResult } = useSalesOrders();
    const salesOrders = soResult?.data ?? [];

    const [filters, setFilters] = useState<SOFilters>({ searchTerm: '', status: '', dateFrom: '', dateTo: '' });

    const openNew = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'sales-order', recordId: null, mode: 'create' },
        title: 'New sales order',
        path: '/ar/sales-orders/new',
        unique: true,
    });

    const filteredData = useMemo(() => salesOrders.filter((item) => {
        const keyword = filters.searchTerm.toLowerCase();
        const matchesSearch = (item.customerName || '').toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword);
        const matchesStatus = filters.status ? item.status === filters.status : true;
        return matchesSearch && matchesStatus;
    }), [filters, salesOrders]);

    const openView = (soId: string) => {
        const so = salesOrders.find((s) => s.id === soId);
        open({
            kind: 'doc-view',
            target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'view' },
            title: so?.number || soId,
            path: `/ar/sales-orders?soId=${soId}`,
        });
    };

    const openEdit = (soId: string) => {
        const so = salesOrders.find((s) => s.id === soId);
        open({
            kind: 'doc-form',
            target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
            title: `Edit ${so?.number || soId}`,
            path: `/ar/sales-orders/edit?soId=${soId}`,
        });
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Sales Orders"
                subtitle="Manage quotations and confirmed orders before invoicing."
                actions={canCreate ? (
                    <Button text="New Sales Order" size="small" icon={<Plus size={16} />} onClick={openNew} />
                ) : undefined}
            />
            <SOCatalogPanel
                data={filteredData as unknown as { id: string; [key: string]: unknown }[]}
                selectedId=""
                filters={filters as unknown as { searchTerm: string; status: string; dateFrom: string; dateTo: string; [key: string]: string }}
                onSearchChange={(searchTerm) => setFilters((p) => ({ ...p, searchTerm }))}
                onFilterChange={(key, value) => setFilters((p) => ({ ...p, [key]: value }))}
                onDateRangeChange={(key, value) => setFilters((p) => ({ ...p, [key]: value }))}
                onSelectSalesOrder={openView}
                onViewSalesOrder={openView}
                canEdit={canEdit}
                onEditSalesOrder={openEdit}
                onPrintSalesOrder={() => {}}
            />
        </div>
    );
};

export default SalesOrderListPane;
