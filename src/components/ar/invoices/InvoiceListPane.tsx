// src/components/ar/invoices/InvoiceListPane.tsx
import React, { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import InvoiceCatalogPanel from './InvoiceCatalogPanel';
import ImportInvoicesModal from './ImportInvoicesModal';
import PageHeader from '../../Layout/PageHeader';
import Button from '../../UI/Button';
import { useInvoices } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions, useExtraAction } from '../../../hooks/useModulePermissions';

interface InvoiceFilters { searchTerm: string; status: string; dateFrom: string; dateTo: string }

const InvoiceListPane = (): React.ReactElement => {
    const { canEdit, canCreate } = useModulePermissions('ar_invoices');
    const canReprint = useExtraAction('ar_invoices', 'reprint');
    const { open } = useWorkspaceNav();
    const [isImportOpen, setIsImportOpen] = useState(false);
    // Read from the same source the form writes to (the invoices API via React
    // Query), so seeded + just-saved invoices both appear here and can be
    // opened as tabs.
    const { data: invoicesResult, isLoading } = useInvoices();
    const invoices = useMemo(() => invoicesResult?.data ?? [], [invoicesResult?.data]);

    const [filters, setFilters] = useState<InvoiceFilters>({ searchTerm: '', status: '', dateFrom: '', dateTo: '' });

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

    // Invoice ids are cuids; the human-facing label is the invoice number.
    const labelFor = (invoiceId: string) => invoices.find((inv) => inv.id === invoiceId)?.number || invoiceId;

    const openView = (invoiceId: string) => {
        open({
            kind: 'doc-view',
            target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'view' },
            title: labelFor(invoiceId),
            path: `/ar/invoices?invoiceId=${invoiceId}`,
        });
    };

    const openEdit = (invoiceId: string) => {
        open({
            kind: 'doc-form',
            target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'edit' },
            title: `Edit ${labelFor(invoiceId)}`,
            path: `/ar/invoices/edit?invoiceId=${invoiceId}`,
        });
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Invoices"
                subtitle="Create, send, and track customer invoices."
                actions={canCreate ? (
                    <Button text="Import" size="small" variant="secondary" icon={<Upload size={16} />} onClick={() => setIsImportOpen(true)} />
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
            <ImportInvoicesModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
        </div>
    );
};

export default InvoiceListPane;
