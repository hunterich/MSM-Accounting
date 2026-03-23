import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import InvoiceWorkbenchLayout from '../../components/ar/invoices/InvoiceWorkbenchLayout';
import SOCatalogPanel from '../../components/ar/salesorders/SOCatalogPanel';
import SODetailTabs from '../../components/ar/salesorders/SODetailTabs';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import SalesOrderPrintTemplate from '../../components/print/SalesOrderPrintTemplate';
import { useSalesOrderStore } from '../../stores/useSalesOrderStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { List, X, Plus } from 'lucide-react';
import { useModulePermissions } from '../../hooks/useModulePermissions';

const SalesOrderWorkbench = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ar_sales_orders');
    const { canCreate: canCreateInvoice } = useModulePermissions('ar_invoices');
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const salesOrders = useSalesOrderStore((s) => s.salesOrders);
    const soItemTemplates = useSalesOrderStore((s) => s.soItemTemplates);
    const convertToInvoice = useSalesOrderStore((s) => s.convertToInvoice);
    const company = useSettingsStore((s) => s.companyInfo);

    const [filters, setFilters] = useState({
        searchTerm: searchParams.get('search') || '',
        status: searchParams.get('status') || '',
        dateFrom: searchParams.get('from') || '',
        dateTo: searchParams.get('to') || ''
    });
    const [selectedSoId, setSelectedSoId] = useState(searchParams.get('soId') || '');
    const [openSoIds, setOpenSoIds] = useState(() => {
        const initial = searchParams.get('soId');
        return initial ? [initial] : [];
    });
    const [detailMode, setDetailMode] = useState(searchParams.get('mode') || 'view');
    const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);

    const [printSoId, setPrintSoId] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    useEffect(() => {
        const state = location.state || {};
        const qsSo = searchParams.get('soId');
        const targetSoId = state.soId || qsSo;
        const targetMode = state.mode || searchParams.get('mode') || 'view';

        if (state.catalogState) {
            setFilters({
                searchTerm: state.catalogState.searchTerm || '',
                status: state.catalogState.status || '',
                dateFrom: state.catalogState.dateFrom || '',
                dateTo: state.catalogState.dateTo || ''
            });
        }

        if (targetSoId) {
            setOpenSoIds((prev) => (prev.includes(targetSoId) ? prev : [...prev, targetSoId]));
            setSelectedSoId(targetSoId);
        }

        setDetailMode(targetMode);
    }, [location.state, searchParams]);

    useEffect(() => {
        const params = {};
        if (filters.searchTerm) params.search = filters.searchTerm;
        if (filters.status) params.status = filters.status;
        if (filters.dateFrom) params.from = filters.dateFrom;
        if (filters.dateTo) params.to = filters.dateTo;
        if (selectedSoId) params.soId = selectedSoId;
        if (selectedSoId && detailMode) params.mode = detailMode;
        setSearchParams(params, { replace: true });
    }, [filters, selectedSoId, detailMode, setSearchParams]);

    const filteredData = useMemo(() => {
        return salesOrders.filter((item) => {
            const keyword = filters.searchTerm.toLowerCase();
            const matchesSearch = item.customerName.toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword);
            const matchesStatus = filters.status ? item.status === filters.status : true;
            let matchesDate = true;
            if (filters.dateFrom) matchesDate = matchesDate && new Date(item.date) >= new Date(filters.dateFrom);
            if (filters.dateTo) matchesDate = matchesDate && new Date(item.date) <= new Date(filters.dateTo);
            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [filters, salesOrders]);

    const selectedSalesOrder = salesOrders.find((order) => order.id === selectedSoId) || null;
    const selectedLines = selectedSalesOrder ? (soItemTemplates[selectedSalesOrder.id] || []) : [];

    const activePrintSo = salesOrders.find((order) => order.id === printSoId) || null;
    const activePrintLines = activePrintSo ? (soItemTemplates[activePrintSo.id] || []) : [];



    const MAX_TABS_PER_ROW = 5;

    const catalogState = useMemo(() => ({
        searchTerm: filters.searchTerm,
        status: filters.status,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        sortKey: '',
        sortDir: '',
        page: 1,
    }), [filters]);

    const handleEdit = (soId) => {
        navigate(`/ar/sales-orders/edit?soId=${soId}`, {
            state: {
                openSoId: soId,
                mode: 'edit',
                returnToWorkbench: true,
                catalogState,
            },
        });
    };

    const queuePrintSo = useCallback((soId) => {
        const targetId = soId || selectedSoId;
        if (!targetId) {
            window.alert('Select a sales order first.');
            return;
        }

        setPrintSoId(targetId);
        setIsPreviewOpen(true);
    }, [selectedSoId]);

    const handleConvert = async (soId) => {
        const invoiceId = await convertToInvoice(soId);
        if (!invoiceId) {
            window.alert('Unable to convert sales order to invoice.');
            return;
        }

        navigate(`/ar/invoices?invoiceId=${invoiceId}`);
    };

    const renderSoTab = (soId) => {
        const so = salesOrders.find((row) => row.id === soId);
        if (!so) return null;

        const isActive = soId === selectedSoId;

        return (
            <button
                key={soId}
                className={`workbench-doc-tab ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedSoId(soId)}
            >
                {so.id}
                <span
                    className="workbench-doc-tab-close"
                    onClick={(event) => {
                        event.stopPropagation();
                        closeSoTab(soId);
                    }}
                >
                    <X size={14} />
                </span>
            </button>
        );
    };

    const firstRowDynamicLimit = Math.max(0, MAX_TABS_PER_ROW - 2);
    const firstRowSoIds = openSoIds.slice(0, firstRowDynamicLimit);
    const remainingSoIds = openSoIds.slice(firstRowDynamicLimit);
    const extraRows = [];

    for (let i = 0; i < remainingSoIds.length; i += MAX_TABS_PER_ROW) {
        extraRows.push(remainingSoIds.slice(i, i + MAX_TABS_PER_ROW));
    }

    const openSoTab = (soId) => {
        setOpenSoIds((prev) => (prev.includes(soId) ? prev : [...prev, soId]));
        setSelectedSoId(soId);
        setDetailMode('view');
        setMobileCatalogOpen(false);
    };

    const closeSoTab = (soId) => {
        setOpenSoIds((prev) => {
            const idx = prev.indexOf(soId);
            const next = prev.filter((id) => id !== soId);

            if (selectedSoId === soId) {
                if (next.length === 0) {
                    setSelectedSoId('');
                } else {
                    const fallback = next[Math.max(0, idx - 1)] || next[0];
                    setSelectedSoId(fallback);
                }
            }

            return next;
        });
    };

    const catalog = (
        <SOCatalogPanel
            data={filteredData}
            selectedId={selectedSoId}
            filters={filters}
            onSearchChange={(searchTerm) => setFilters((prev) => ({ ...prev, searchTerm }))}
            onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onDateRangeChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onSelectSalesOrder={openSoTab}
            onViewSalesOrder={openSoTab}
            canEdit={canEdit}
            onEditSalesOrder={handleEdit}
            onPrintSalesOrder={queuePrintSo}
        />
    );

    const detail = selectedSalesOrder ? (
        <SODetailTabs
            salesOrder={selectedSalesOrder}
            lineItems={selectedLines}
            onEdit={() => handleEdit(selectedSalesOrder.id)}
            onPrint={() => queuePrintSo(selectedSalesOrder.id)}
            onConvertToInvoice={() => handleConvert(selectedSalesOrder.id)}
            canEdit={canEdit}
            canConvertToInvoice={canCreateInvoice}
        />
    ) : (
        <div className="invoice-workbench-card">
            <div className="empty-detail">Select a sales order from catalog to view details.</div>
        </div>
    );

    return (
        <div className="container ar-module container-full-width">
            <div className="workbench-doc-tabs">
                <div className="workbench-doc-tab-row">
                    <button
                        className="workbench-doc-tab workbench-doc-tab-catalog"
                        onClick={() => {
                            setSelectedSoId('');
                            navigate('/ar/sales-orders', {
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
                        onClick={() => navigate('/ar/sales-orders/new')}
                        disabled={!canCreate}
                        title="New sales order"
                    >
                        <Plus size={16} />
                        New Sales Order
                    </button>
                    {firstRowSoIds.map((soId) => renderSoTab(soId))}
                    <div className="workbench-tab-count">Open tabs: {openSoIds.length}</div>
                </div>
                {extraRows.map((row, rowIndex) => (
                    <div key={`extra-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                        {row.map((soId) => renderSoTab(soId))}
                    </div>
                ))}
            </div>

            <InvoiceWorkbenchLayout
                catalog={catalog}
                detail={detail}
                showDetail={Boolean(selectedSoId)}
                mobileCatalogOpen={mobileCatalogOpen}
                onToggleCatalog={() => setMobileCatalogOpen((prev) => !prev)}
            />

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Sales Order Print Preview"
                documentTitle={`SalesOrder_${activePrintSo?.id || ''}`}
            >
                {activePrintSo && (
                    <SalesOrderPrintTemplate
                        salesOrder={activePrintSo}
                        lineItems={activePrintLines}
                        company={company}
                    />
                )}
            </PrintPreviewModal>
        </div>
    );
};

export default SalesOrderWorkbench;
