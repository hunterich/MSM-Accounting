// src/components/ar/salesorders/SalesOrderListPane.tsx
import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import SOCatalogPanel from './SOCatalogPanel';
import PageHeader from '../../Layout/PageHeader';
import Button from '../../UI/Button';
import { useSalesOrders } from '../../../hooks/useAR';
import { toSalesOrderView } from '../../../lib/salesOrderView';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface SOFilters { searchTerm: string; status: string; dateFrom: string; dateTo: string }

const SalesOrderListPane = (): React.ReactElement => {
    const { canCreate, canEdit } = useModulePermissions('ar_sales_orders');
    const { open } = useWorkspaceNav();
    // The sales orders API — the same source `SOFormV2` saves to. This pane used
    // to read a browser-local store seeded with three fixtures, so a saved order
    // never showed up in its own list.
    const { data: result } = useSalesOrders({ limit: 200 });
    const salesOrders = useMemo(
        () => (result?.data ?? []).map(toSalesOrderView),
        [result?.data],
    );

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
        const matchesSearch = item.customerName.toLowerCase().includes(keyword) || item.no.toLowerCase().includes(keyword);
        const matchesStatus = filters.status ? item.status === filters.status : true;
        // The panel has always offered these two inputs; nothing read them.
        const matchesFrom = filters.dateFrom ? item.date >= filters.dateFrom : true;
        const matchesTo = filters.dateTo ? item.date <= filters.dateTo : true;
        return matchesSearch && matchesStatus && matchesFrom && matchesTo;
    }), [filters, salesOrders]);

    // Tabs are titled by the document number; `soId` is the cuid every lookup keys off.
    const labelFor = (soId: string) => salesOrders.find((so) => so.id === soId)?.no ?? soId;

    const openView = (soId: string) => {
        open({
            kind: 'doc-view',
            target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'view' },
            title: labelFor(soId),
            path: `/ar/sales-orders?soId=${soId}`,
        });
    };

    const openEdit = (soId: string) => {
        open({
            kind: 'doc-form',
            target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
            title: `Edit ${labelFor(soId)}`,
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
