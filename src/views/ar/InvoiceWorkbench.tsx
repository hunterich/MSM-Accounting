import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import InvoiceWorkbenchLayout from '../../components/ar/invoices/InvoiceWorkbenchLayout';
import InvoiceCatalogPanel from '../../components/ar/invoices/InvoiceCatalogPanel';
import InvoiceDetailTabs from '../../components/ar/invoices/InvoiceDetailTabs';
import Button from '../../components/UI/Button';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import InvoicePrintTemplate from '../../components/print/InvoicePrintTemplate';
import { useInvoiceStore } from '../../stores/useInvoiceStore';
import { useInvoices, useVoidInvoice } from '../../hooks/useAR';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { exportToCsv } from '../../utils/exportCsv';
import { Download, Upload } from 'lucide-react';
import ImportInvoicesModal from '../../components/ar/invoices/ImportInvoicesModal';
import { useModulePermissions, useExtraAction } from '../../hooks/useModulePermissions';

interface InvoiceFilters {
    searchTerm: string;
    status: string;
    dateFrom: string;
    dateTo: string;
}

const InvoiceWorkbench = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    // List data comes from the API; invoiceItemTemplates stay in the local store (used for print)
    const { data: invoicesResult, isLoading: invoicesLoading } = useInvoices();
    const invoices = invoicesResult?.data ?? [];
    const voidInvoice = useVoidInvoice();

    const handleVoidInvoice = (invoiceId: string) => {
        if (!window.confirm('Void this invoice? Its journal entries will be reversed and the sold stock returned to inventory. This cannot be undone.')) return;
        voidInvoice.mutate(invoiceId, {
            onError: (error: unknown) => {
                window.alert(error instanceof Error ? error.message : 'Failed to void invoice');
            },
        });
    };
    const invoiceItemTemplates = useInvoiceStore((s) => s.invoiceItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const taxRate = useSettingsStore((s) => s.taxSettings.defaultRate);

    const [filters, setFilters] = useState<InvoiceFilters>({
        searchTerm: searchParams.get('search') || '',
        status: searchParams.get('status') || '',
        dateFrom: searchParams.get('from') || '',
        dateTo: searchParams.get('to') || ''
    });
    const [detailMode, setDetailMode] = useState<string>(searchParams.get('mode') || 'view');
    const [mobileCatalogOpen, setMobileCatalogOpen] = useState<boolean>(false);

    const [printInvoiceId, setPrintInvoiceId] = useState<string>('');
    const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
    const [isImportOpen, setIsImportOpen] = useState<boolean>(false);

    const { canCreate, canEdit, canDelete } = useModulePermissions('ar_invoices');
    const canReprint = useExtraAction('ar_invoices', 'reprint');

    // Tab state managed by useDocumentTabs
    const { selectedId: selectedInvoiceId, openIds: openInvoiceIds, openTab: openInvoiceTab, closeTab: closeInvoiceTab, tabRows } = useDocumentTabs({ urlParam: 'invoiceId', maxPerRow: 5 });

    // Sync selectedId setter for external use (location.state navigation)
    // We need a way to call openTab from the effect below
    const handleOpenTab = useCallback((invoiceId: string) => {
        openInvoiceTab(invoiceId);
    }, [openInvoiceTab]);

    useEffect(() => {
        const state = location.state || {};
        const qsInvoice = searchParams.get('invoiceId');
        const targetInvoiceId = state.invoiceId || qsInvoice;
        const targetMode = state.mode || searchParams.get('mode') || 'view';

        if (state.catalogState) {
            setFilters({
                searchTerm: state.catalogState.searchTerm || '',
                status: state.catalogState.status || '',
                dateFrom: state.catalogState.dateFrom || '',
                dateTo: state.catalogState.dateTo || ''
            });
        }
        if (targetInvoiceId) {
            handleOpenTab(targetInvoiceId);
        }
        setDetailMode(targetMode);
    }, [location.state, searchParams, handleOpenTab]);

    useEffect(() => {
        const params: Record<string, string> = {};
        if (filters.searchTerm) params.search = filters.searchTerm;
        if (filters.status) params.status = filters.status;
        if (filters.dateFrom) params.from = filters.dateFrom;
        if (filters.dateTo) params.to = filters.dateTo;
        if (selectedInvoiceId) params.invoiceId = selectedInvoiceId;
        if (selectedInvoiceId && detailMode) params.mode = detailMode;
        setSearchParams(params, { replace: true });
    }, [filters, selectedInvoiceId, detailMode, setSearchParams]);

    const filteredData = useMemo(() => {
        return invoices.filter((item) => {
            const keyword = filters.searchTerm.toLowerCase();
            const dateField = item.issueDate || item.date;
            const matchesSearch = item.customerName.toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword)
                || (item.number || '').toLowerCase().includes(keyword);
            const matchesStatus = filters.status ? item.status === filters.status : true;
            let matchesDate = true;
            if (filters.dateFrom) matchesDate = matchesDate && new Date(dateField) >= new Date(filters.dateFrom);
            if (filters.dateTo) matchesDate = matchesDate && new Date(dateField) <= new Date(filters.dateTo);
            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [filters, invoices]);

    const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
    const activePrintInvoice = invoices.find((invoice) => invoice.id === printInvoiceId) || null;
    const activePrintLines = activePrintInvoice ? (invoiceItemTemplates[activePrintInvoice.id] || []) : [];

    const catalogState = useMemo(() => ({
        searchTerm: filters.searchTerm,
        status: filters.status,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        sortKey: '',
        sortDir: '',
        page: 1
    }), [filters]);

    const handleEdit = (invoiceId: string) => {
        navigate('/ar/invoices/edit', {
            state: {
                openInvoiceId: invoiceId,
                mode: 'edit',
                returnToWorkbench: true,
                catalogState
            }
        });
    };

    const queuePrintInvoice = useCallback((invoiceId: string) => {
        const targetId = invoiceId || selectedInvoiceId;
        if (!targetId) {
            window.alert('Select an invoice first.');
            return;
        }
        setPrintInvoiceId(targetId);
        setIsPreviewOpen(true);
    }, [selectedInvoiceId]);

    const handleExportCsv = () => {
        const rows = filteredData.map((invoice) => ({
            id: invoice.number || invoice.id,
            customerName: invoice.customerName,
            issueDate: invoice.issueDate || invoice.date || '',
            dueDate: invoice.dueDate || '',
            amount: Number(invoice.amount || 0),
            status: invoice.status,
        }));

        exportToCsv('invoices.csv', rows, [
            { label: 'Invoice #', key: 'id' },
            { label: 'Customer', key: 'customerName' },
            { label: 'Date', key: 'issueDate' },
            { label: 'Due Date', key: 'dueDate' },
            { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' },
        ]);
    };

    const catalog = (
        <InvoiceCatalogPanel
            // casts: Invoice/InvoiceFilters lack index signatures required by panel components
            data={filteredData as unknown as { id: string; [key: string]: unknown }[]}
            isLoading={invoicesLoading}
            selectedId={selectedInvoiceId}
            filters={filters as unknown as { searchTerm: string; status: string; dateFrom: string; dateTo: string; [key: string]: string }}
            onSearchChange={(searchTerm) => setFilters((prev) => ({ ...prev, searchTerm }))}
            onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onDateRangeChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onSelectInvoice={(id) => { openInvoiceTab(id); setDetailMode('view'); setMobileCatalogOpen(false); }}
            onViewInvoice={(id) => { openInvoiceTab(id); setDetailMode('view'); setMobileCatalogOpen(false); }}
            canEdit={canEdit}
            canPrint={canReprint}
            onEditInvoice={handleEdit}
            onPrintInvoice={queuePrintInvoice}
        />
    );

    const detail = selectedInvoice ? (
        <InvoiceDetailTabs
            invoice={selectedInvoice as unknown as { id: string; [key: string]: unknown }}
            onEdit={() => handleEdit(selectedInvoice.id)}
            onPrint={() => queuePrintInvoice(selectedInvoice.id)}
            onVoid={() => handleVoidInvoice(selectedInvoice.id)}
            canEdit={canEdit}
            canDelete={canDelete}
            canPrint={canReprint}
            canVoid={canEdit}
        />
    ) : (
        <div className="invoice-workbench-card">
            <div className="empty-detail">Select an invoice from catalog to view details.</div>
        </div>
    );

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Invoices"
                subtitle="Create, send, and track customer invoices."
                actions={
                    <>
                        {canCreate && (
                            <Button
                                text="Import"
                                size="small"
                                variant="secondary"
                                icon={<Upload size={16} />}
                                onClick={() => setIsImportOpen(true)}
                            />
                        )}
                        <Button
                            text="Export CSV"
                            size="small"
                            variant="secondary"
                            icon={<Download size={16} />}
                            onClick={handleExportCsv}
                        />
                    </>
                }
            />

            <DocumentTabBar
                openIds={openInvoiceIds}
                selectedId={selectedInvoiceId}
                tabRows={tabRows}
                getLabel={(id) => invoices.find((inv) => inv.id === id)?.number || id}
                onSelect={(id) => { openInvoiceTab(id); }}
                onClose={closeInvoiceTab}
                newTabLabel="New Invoice"
                onNewTab={canCreate ? () => navigate('/ar/invoices/new') : undefined}
                disableNew={!canCreate}
                onCatalog={() => {
                    navigate('/ar/invoices/workbench', { state: { catalogState } });
                }}
                firstRowSuffix={
                    <div className="workbench-tab-count">
                        Open tabs: {openInvoiceIds.length}
                    </div>
                }
            />

            <InvoiceWorkbenchLayout
                catalog={catalog}
                detail={detail}
                showDetail={Boolean(selectedInvoiceId)}
                mobileCatalogOpen={mobileCatalogOpen}
                onToggleCatalog={() => setMobileCatalogOpen((prev) => !prev)}
            />

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Invoice Print Preview"
                documentTitle={`Invoice_${activePrintInvoice?.number || activePrintInvoice?.id || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                {activePrintInvoice && (
                    // casts: Invoice/CompanyInfo lack index signatures required by print template
                    <InvoicePrintTemplate
                        invoice={activePrintInvoice as unknown as Record<string, unknown>}
                        lineItems={activePrintLines as unknown as Record<string, unknown>[]}
                        company={company as unknown as Record<string, unknown>}
                        options={printSettings}
                        taxRate={taxRate}
                    />
                )}
            </PrintPreviewModal>

            <ImportInvoicesModal
                isOpen={isImportOpen}
                onClose={() => setIsImportOpen(false)}
            />
        </div>
    );
};

export default InvoiceWorkbench;
