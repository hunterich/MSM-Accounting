import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import InvoiceWorkbenchLayout from '../../components/ar/invoices/InvoiceWorkbenchLayout';
import SOCatalogPanel from '../../components/ar/salesorders/SOCatalogPanel';
import SODetailTabs from '../../components/ar/salesorders/SODetailTabs';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import SalesOrderPrintTemplate from '../../components/print/SalesOrderPrintTemplate';
import Button from '../../components/UI/Button';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useSalesOrders, useConvertSOToInvoice } from '../../hooks/useAR';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { exportToCsv } from '../../utils/exportCsv';
import { Download } from 'lucide-react';
import { useModulePermissions } from '../../hooks/useModulePermissions';

interface SOFilters {
    searchTerm: string;
    status: string;
    dateFrom: string;
    dateTo: string;
}

const SalesOrderWorkbench = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ar_sales_orders');
    const { canCreate: canCreateInvoice } = useModulePermissions('ar_invoices');
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const { data: soResult, isLoading: soLoading } = useSalesOrders();
    const salesOrders = soResult?.data ?? [];
    const convertSOToInvoice = useConvertSOToInvoice();
    const company = useSettingsStore((s) => s.companyInfo);

    const [filters, setFilters] = useState<SOFilters>({
        searchTerm: searchParams.get('search') || '',
        status: searchParams.get('status') || '',
        dateFrom: searchParams.get('from') || '',
        dateTo: searchParams.get('to') || ''
    });
    const {
        selectedId: selectedSoId,
        openIds: openSoIds,
        openTab,
        closeTab: closeSoTab,
        selectNone,
        tabRows,
    } = useDocumentTabs({ urlParam: 'soId', maxPerRow: 5 });
    const [detailMode, setDetailMode] = useState<string>(searchParams.get('mode') || 'view');
    const [mobileCatalogOpen, setMobileCatalogOpen] = useState<boolean>(false);

    const [printSoId, setPrintSoId] = useState<string>('');
    const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);

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
            openTab(targetSoId);
        }

        setDetailMode(targetMode);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state, searchParams]);

    useEffect(() => {
        const params: Record<string, string> = {};
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
            const itemDate = (item as unknown as { date?: string }).date || '';
            const matchesSearch = (item.customerName || '').toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword);
            const matchesStatus = filters.status ? item.status === filters.status : true;
            let matchesDate = true;
            if (filters.dateFrom) matchesDate = matchesDate && new Date(itemDate) >= new Date(filters.dateFrom);
            if (filters.dateTo) matchesDate = matchesDate && new Date(itemDate) <= new Date(filters.dateTo);
            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [filters, salesOrders]);

    const selectedSalesOrder = salesOrders.find((order) => order.id === selectedSoId) || null;
    const selectedLines = selectedSalesOrder ? (selectedSalesOrder.items || []) : [];

    const activePrintSo = salesOrders.find((order) => order.id === printSoId) || null;
    const activePrintLines = activePrintSo ? (activePrintSo.items || []) : [];



    const catalogState = useMemo(() => ({
        searchTerm: filters.searchTerm,
        status: filters.status,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        sortKey: '',
        sortDir: '',
        page: 1,
    }), [filters]);

    const handleEdit = (soId: string) => {
        navigate(`/ar/sales-orders/edit?soId=${soId}`, {
            state: {
                openSoId: soId,
                mode: 'edit',
                returnToWorkbench: true,
                catalogState,
            },
        });
    };

    const queuePrintSo = useCallback((soId: string) => {
        const targetId = soId || selectedSoId;
        if (!targetId) {
            window.alert('Select a sales order first.');
            return;
        }

        setPrintSoId(targetId);
        setIsPreviewOpen(true);
    }, [selectedSoId]);

    const handleConvert = async (soId: string) => {
        try {
            const result = await convertSOToInvoice.mutateAsync(soId);
            const resultRecord = result as unknown as { invoice?: { id?: string; number?: string } };
            const invoiceId = resultRecord?.invoice?.id || resultRecord?.invoice?.number;
            navigate(`/ar/invoices${invoiceId ? `?invoiceId=${invoiceId}` : ''}`);
        } catch (err) {
            window.alert(`Unable to convert sales order to invoice: ${(err as Error)?.message || 'Unknown error'}`);
        }
    };

    const openSoTab = (soId: string) => {
        openTab(soId);
        setDetailMode('view');
        setMobileCatalogOpen(false);
    };

    const handleExportCsv = () => {
        const rows = filteredData.map((so) => {
            const loose = so as unknown as { date?: string; amount?: number };
            return {
                id: so.number || so.id,
                customerName: so.customerName || '',
                date: loose.date || '',
                amount: Number(loose.amount || 0),
                status: so.status,
            };
        });

        exportToCsv('sales-orders.csv', rows, [
            { label: 'SO #', key: 'id' },
            { label: 'Customer', key: 'customerName' },
            { label: 'Date', key: 'date' },
            { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' },
        ]);
    };

    const catalog = (
        <SOCatalogPanel
            // casts: SalesOrder/SOFilters lack index signatures required by panel components
            data={filteredData as unknown as { id: string; [key: string]: unknown }[]}
            selectedId={selectedSoId}
            filters={filters as unknown as { searchTerm: string; status: string; dateFrom: string; dateTo: string; [key: string]: string }}
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
            // casts: SalesOrder/SalesOrderItem lack index signatures required by SODetailTabs
            salesOrder={selectedSalesOrder as unknown as Record<string, unknown>}
            lineItems={selectedLines as unknown as Record<string, unknown>[]}
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
            <PageHeader
                title="Sales Orders"
                subtitle="Manage quotations and confirmed orders before invoicing."
                actions={
                    <Button
                        text="Export CSV"
                        size="small"
                        variant="secondary"
                        icon={<Download size={16} />}
                        onClick={handleExportCsv}
                    />
                }
            />

            <DocumentTabBar
                openIds={openSoIds}
                selectedId={selectedSoId}
                tabRows={tabRows}
                getLabel={(id) => salesOrders.find((so) => so.id === id)?.number || id}
                onSelect={openSoTab}
                onClose={closeSoTab}
                newTabLabel="New Sales Order"
                onNewTab={canCreate ? () => navigate('/ar/sales-orders/new') : undefined}
                disableNew={!canCreate}
                onCatalog={() => {
                    selectNone();
                    navigate('/ar/sales-orders', { state: { catalogState } });
                }}
                firstRowSuffix={
                    <div className="workbench-tab-count">
                        Open tabs: {openSoIds.length}
                    </div>
                }
            />

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
                    // casts: SalesOrder/SalesOrderItem/CompanyInfo lack index signatures required by print template
                    <SalesOrderPrintTemplate
                        salesOrder={activePrintSo as unknown as Record<string, unknown>}
                        lineItems={activePrintLines as unknown as Record<string, unknown>[]}
                        company={company as unknown as Record<string, unknown>}
                    />
                )}
            </PrintPreviewModal>
        </div>
    );
};

export default SalesOrderWorkbench;
