// src/components/ar/invoices/InvoiceListPane.tsx
import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import InvoiceCatalogPanel from './InvoiceCatalogPanel';
import PageHeader from '../../Layout/PageHeader';
import Button from '../../UI/Button';
import { useInvoices } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions, useExtraAction } from '../../../hooks/useModulePermissions';

interface InvoiceFilters { searchTerm: string; status: string; dateFrom: string; dateTo: string }

const InvoiceListPane = (): React.ReactElement => {
    const { canCreate, canEdit } = useModulePermissions('ar_invoices');
    const canReprint = useExtraAction('ar_invoices', 'reprint');
    const { open } = useWorkspaceNav();
    // Read from the same source the form writes to (the invoices API via React
    // Query), so seeded + just-saved invoices both appear here and can be
    // opened as tabs.
    const { data: invoicesResult, isLoading } = useInvoices();
    const invoices = useMemo(() => invoicesResult?.data ?? [], [invoicesResult?.data]);

    const [filters, setFilters] = useState<InvoiceFilters>({ searchTerm: '', status: '', dateFrom: '', dateTo: '' });

    const openNew = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'invoice', recordId: null, mode: 'create' },
        title: 'New invoice',
        path: '/ar/invoices/new',
        unique: true,
    });

    const filteredData = useMemo(() => invoices.filter((item) => {
        const keyword = filters.searchTerm.toLowerCase();
        const dateField = item.issueDate || item.date;
        const matchesSearch = (item.customerName || '').toLowerCase().includes(keyword)
            || item.id.toLowerCase().includes(keyword)
            || (item.number || '').toLowerCase().includes(keyword);
        const matchesStatus = filters.status ? item.status === filters.status : true;
        let matchesDate = true;
        if (filters.dateFrom) matchesDate = matchesDate && new Date(dateField) >= new Date(filters.dateFrom);
        if (filters.dateTo) matchesDate = matchesDate && new Date(dateField) <= new Date(filters.dateTo);
        return matchesSearch && matchesStatus && matchesDate;
    }), [filters, invoices]);

    const openView = (invoiceId: string) => {
        open({
            kind: 'doc-view',
            target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'view' },
            title: invoiceId,
            path: `/ar/invoices?invoiceId=${invoiceId}`,
        });
    };

    const openEdit = (invoiceId: string) => {
        open({
            kind: 'doc-form',
            target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'edit' },
            title: `Edit ${invoiceId}`,
            path: `/ar/invoices/edit?invoiceId=${invoiceId}`,
        });
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Invoices"
                subtitle="Create, send, and track customer invoices."
                actions={canCreate ? (
                    <Button text="New Invoice" size="small" icon={<Plus size={16} />} onClick={openNew} />
                ) : undefined}
            />
            <InvoiceCatalogPanel
                data={filteredData as unknown as { id: string; [key: string]: unknown }[]}
                isLoading={isLoading}
                selectedId=""
                filters={filters as unknown as { searchTerm: string; status: string; dateFrom: string; dateTo: string; [key: string]: string }}
                onSearchChange={(searchTerm) => setFilters((p) => ({ ...p, searchTerm }))}
                onFilterChange={(key, value) => setFilters((p) => ({ ...p, [key]: value }))}
                onDateRangeChange={(key, value) => setFilters((p) => ({ ...p, [key]: value }))}
                onSelectInvoice={openView}
                onViewInvoice={openView}
                canEdit={canEdit}
                canPrint={canReprint}
                onEditInvoice={openEdit}
                onPrintInvoice={() => {}}
            />
        </div>
    );
};

export default InvoiceListPane;
