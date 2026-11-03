// src/components/ar/invoices/InvoiceListPane.tsx
import React, { useEffect, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../../../api/apiClient';
import InvoiceCatalogPanel from './InvoiceCatalogPanel';
import InvoicePrintPreview from './InvoicePrintPreview';
import ImportInvoicesModal from './ImportInvoicesModal';
import PageHeader from '../../Layout/PageHeader';
import Button from '../../UI/Button';
import { useInvoices } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions, useExtraAction } from '../../../hooks/useModulePermissions';

import { invoiceListQuery, type InvoiceFilters } from './invoiceListQuery';
import { useCatalogPagination } from '../../../hooks/useCatalogPagination';

const InvoiceListPane = (): React.ReactElement => {
    const { canEdit, canCreate } = useModulePermissions('ar_invoices');
    const canReprint = useExtraAction('ar_invoices', 'reprint');
    const { open } = useWorkspaceNav();
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);
    const [filters, setFilters] = useState<InvoiceFilters>({ searchTerm: '', status: '', dateFrom: '', dateTo: '' });
    const { page: _page, limit: _limit, ...queryFilters } = invoiceListQuery(filters, 1, 20);
    const paging = useCatalogPagination({ ...queryFilters, search: filters.searchTerm.trim() });
    const { page, limit, onPageChange: setPage, onLimitChange: setLimit } = paging;
    // Read from the same source the form writes to (the invoices API via React
    // Query), so seeded + just-saved invoices both appear here and can be
    // opened as tabs.
    const { data: invoicesResult, isLoading, isFetching, error, refetch } = useInvoices(paging.query);
    const invoices = invoicesResult?.data ?? [];
    const total = invoicesResult?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    useEffect(() => {
        if (invoicesResult && page > totalPages) setPage(totalPages);
    }, [invoicesResult, page, totalPages]);
    const changeFilter = (key: keyof InvoiceFilters, value: string) => {
        setFilters((previous) => ({ ...previous, [key]: value }));
    };

    const exportAll = async () => {
        setExportError('');
        setExporting(true);
        try {
            const { page: _page, limit: _limit, ...activeFilters } = paging.query;
            const csv = await api.getText('/api/v1/invoices/export', activeFilters);
            const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'invoices-filtered.csv';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            setExportError(err instanceof Error ? err.message : 'Unable to export invoices');
        } finally {
            setExporting(false);
        }
    };

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
        <div className="container ar-module container-full-width flex h-full min-h-0 flex-col">
            <div className="shrink-0">
            <PageHeader
                title="Invoices"
                subtitle="Create, send, and track customer invoices."
                actions={<div className="flex gap-2">
                    <Button text="Export all filtered CSV" size="small" variant="secondary" icon={<Download size={16} />}
                        disabled={exporting || isFetching || Boolean(error) || String(paging.query.search ?? '') !== filters.searchTerm.trim()}
                        onClick={() => void exportAll()} />
                    {canCreate && <Button text="Import" size="small" variant="secondary" icon={<Upload size={16} />} onClick={() => setIsImportOpen(true)} />}
                </div>}
            />
            </div>
            {exportError && <div role="alert" className="shrink-0 p-2 text-sm text-danger-600">{exportError}</div>}
            {error && <div role="alert" className="shrink-0 p-2 text-sm text-danger-600">
                Unable to load invoices. <button type="button" className="underline" onClick={() => void refetch()}>Retry</button>
            </div>}
            <InvoiceCatalogPanel
                data={invoices as unknown as { id: string; [key: string]: unknown }[]}
                isLoading={isLoading}
                selectedId=""
                filters={filters as unknown as { searchTerm: string; status: string; dateFrom: string; dateTo: string; [key: string]: string }}
                onSearchChange={(value) => changeFilter('searchTerm', value)}
                onFilterChange={(_key, value) => changeFilter('status', value)}
                onDateRangeChange={(key, value) => changeFilter(key as 'dateFrom' | 'dateTo', value)}
                pagination={{ page, limit, total, busy: isFetching || Boolean(error), onPageChange: setPage,
                    onLimitChange: (value) => { setLimit(value); setPage(1); } }}
                onSelectInvoice={openView}
                onViewInvoice={openView}
                canEdit={canEdit}
                canPrint={canReprint}
                onEditInvoice={openEdit}
                onPrintInvoice={setPrintInvoiceId}
            />
            <ImportInvoicesModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
            <InvoicePrintPreview invoiceId={printInvoiceId} onClose={() => setPrintInvoiceId(null)} />
        </div>
    );
};

export default InvoiceListPane;
