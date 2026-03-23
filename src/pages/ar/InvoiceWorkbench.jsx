import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import InvoiceWorkbenchLayout from '../../components/ar/invoices/InvoiceWorkbenchLayout';
import InvoiceCatalogPanel from '../../components/ar/invoices/InvoiceCatalogPanel';
import InvoiceDetailTabs from '../../components/ar/invoices/InvoiceDetailTabs';
import Button from '../../components/UI/Button';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import InvoicePrintTemplate from '../../components/print/InvoicePrintTemplate';
import { useInvoiceStore } from '../../stores/useInvoiceStore';
import { useInvoices } from '../../hooks/useAR';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { exportToCsv } from '../../utils/exportCsv';
import { List, X, Plus, Download, Upload } from 'lucide-react';
import ImportInvoicesModal from '../../components/ar/invoices/ImportInvoicesModal';
import { useModulePermissions } from '../../hooks/useModulePermissions';

const InvoiceWorkbench = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    // List data comes from the API; invoiceItemTemplates stay in the local store (used for print)
    const { data: invoicesResult, isLoading: invoicesLoading } = useInvoices();
    const invoices = invoicesResult?.data ?? [];
    const invoiceItemTemplates = useInvoiceStore((s) => s.invoiceItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);
    const taxRate = useSettingsStore((s) => s.taxSettings.defaultRate);

    const [filters, setFilters] = useState({
        searchTerm: searchParams.get('search') || '',
        status: searchParams.get('status') || '',
        dateFrom: searchParams.get('from') || '',
        dateTo: searchParams.get('to') || ''
    });
    const [selectedInvoiceId, setSelectedInvoiceId] = useState(searchParams.get('invoiceId') || '');
    const [openInvoiceIds, setOpenInvoiceIds] = useState(() => {
        const initial = searchParams.get('invoiceId');
        return initial ? [initial] : [];
    });
    const [detailMode, setDetailMode] = useState(searchParams.get('mode') || 'view');
    const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);

    const [printInvoiceId, setPrintInvoiceId] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);

    const { canCreate, canEdit, canDelete } = useModulePermissions('ar_invoices');

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
            setOpenInvoiceIds((prev) => (prev.includes(targetInvoiceId) ? prev : [...prev, targetInvoiceId]));
            setSelectedInvoiceId(targetInvoiceId);
        }
        setDetailMode(targetMode);
    }, [location.state, searchParams]);

    useEffect(() => {
        const params = {};
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



    const MAX_TABS_PER_ROW = 5;

    const catalogState = useMemo(() => ({
        searchTerm: filters.searchTerm,
        status: filters.status,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        sortKey: '',
        sortDir: '',
        page: 1
    }), [filters]);

    const handleEdit = (invoiceId) => {
        navigate('/ar/invoices/edit', {
            state: {
                openInvoiceId: invoiceId,
                mode: 'edit',
                returnToWorkbench: true,
                catalogState
            }
        });
    };

    const queuePrintInvoice = useCallback((invoiceId) => {
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

    const renderInvoiceTab = (invoiceId) => {
        const invoice = invoices.find((row) => row.id === invoiceId);
        if (!invoice) return null;
        const isActive = invoiceId === selectedInvoiceId;
        return (
            <button
                key={invoiceId}
                className={`workbench-doc-tab ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedInvoiceId(invoiceId)}
            >
                {invoice.number || invoice.id}
                <span
                    className="workbench-doc-tab-close"
                    onClick={(e) => {
                        e.stopPropagation();
                        closeInvoiceTab(invoiceId);
                    }}
                >
                    <X size={14} />
                </span>
            </button>
        );
    };

    const firstRowDynamicLimit = Math.max(0, MAX_TABS_PER_ROW - 2);
    const firstRowInvoiceIds = openInvoiceIds.slice(0, firstRowDynamicLimit);
    const remainingInvoiceIds = openInvoiceIds.slice(firstRowDynamicLimit);
    const extraRows = [];
    for (let i = 0; i < remainingInvoiceIds.length; i += MAX_TABS_PER_ROW) {
        extraRows.push(remainingInvoiceIds.slice(i, i + MAX_TABS_PER_ROW));
    }

    const openInvoiceTab = (invoiceId) => {
        setOpenInvoiceIds((prev) => (prev.includes(invoiceId) ? prev : [...prev, invoiceId]));
        setSelectedInvoiceId(invoiceId);
        setDetailMode('view');
        setMobileCatalogOpen(false);
    };

    const closeInvoiceTab = (invoiceId) => {
        setOpenInvoiceIds((prev) => {
            const idx = prev.indexOf(invoiceId);
            const next = prev.filter((id) => id !== invoiceId);
            if (selectedInvoiceId === invoiceId) {
                if (next.length === 0) {
                    setSelectedInvoiceId('');
                } else {
                    const fallback = next[Math.max(0, idx - 1)] || next[0];
                    setSelectedInvoiceId(fallback);
                }
            }
            return next;
        });
    };

    const catalog = (
        <InvoiceCatalogPanel
            data={filteredData}
            isLoading={invoicesLoading}
            selectedId={selectedInvoiceId}
            filters={filters}
            onSearchChange={(searchTerm) => setFilters((prev) => ({ ...prev, searchTerm }))}
            onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onDateRangeChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onSelectInvoice={openInvoiceTab}
            onViewInvoice={openInvoiceTab}
            canEdit={canEdit}
            onEditInvoice={handleEdit}
            onPrintInvoice={queuePrintInvoice}
        />
    );

    const detail = selectedInvoice ? (
        <InvoiceDetailTabs
            invoice={selectedInvoice}
            onEdit={() => handleEdit(selectedInvoice.id)}
            onPrint={() => queuePrintInvoice(selectedInvoice.id)}
            canEdit={canEdit}
            canDelete={canDelete}
        />
    ) : (
        <div className="invoice-workbench-card">
            <div className="empty-detail">Select an invoice from catalog to view details.</div>
        </div>
    );

    return (
        <div className="container ar-module container-full-width">
            <div className="flex justify-end mb-2 gap-2">
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
            </div>

            <div className="workbench-doc-tabs">
                <div className="workbench-doc-tab-row">
                    <button
                        className="workbench-doc-tab workbench-doc-tab-catalog"
                        onClick={() => {
                            setSelectedInvoiceId('');
                            navigate('/ar/invoices/workbench', {
                                state: { catalogState },
                            });
                        }}
                        title="Back to catalog"
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    <button
                        className={`workbench-doc-tab workbench-doc-tab-new ${canCreate ? '' : 'opacity-60 cursor-not-allowed'}`}
                        onClick={() => navigate('/ar/invoices/new')}
                        disabled={!canCreate}
                        title="New invoice"
                    >
                        <Plus size={16} />
                        New Invoice
                    </button>
                    {firstRowInvoiceIds.map((invoiceId) => renderInvoiceTab(invoiceId))}
                    <div className="workbench-tab-count">
                        Open tabs: {openInvoiceIds.length}
                    </div>
                </div>
                {extraRows.map((row, rowIndex) => (
                    <div key={`extra-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                        {row.map((invoiceId) => renderInvoiceTab(invoiceId))}
                    </div>
                ))}
            </div>

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
            >
                {activePrintInvoice && (
                    <InvoicePrintTemplate
                        invoice={activePrintInvoice}
                        lineItems={activePrintLines}
                        company={company}
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
