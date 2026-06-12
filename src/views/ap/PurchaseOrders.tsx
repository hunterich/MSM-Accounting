import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import PurchaseOrderPrintTemplate from '../../components/print/PurchaseOrderPrintTemplate';
import { Plus, Search, List, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { usePurchaseOrders, AP_KEYS } from '../../hooks/useAP';
import { usePurchaseOrderStore } from '../../stores/usePurchaseOrderStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { api } from '../../api/apiClient';

interface POFilters {
    status: string;
}

interface DateRange {
    from: string;
    to: string;
}

interface ReceiveLine {
    purchaseOrderLineId: string;
    qtyReceived: number;
}

interface PurchaseOrdersProps {
    /** When true, render a focused "Receive Goods" list limited to receivable POs. */
    receivingMode?: boolean;
}

const PurchaseOrders = ({ receivingMode = false }: PurchaseOrdersProps) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { canCreate, canEdit } = useModulePermissions('ap_pos');
    const { data: posResult, isLoading } = usePurchaseOrders();
    const purchaseOrders = posResult?.data ?? [];
    // poItemTemplates stays in local store (for print until API supports line fetch)
    const poItemTemplates = usePurchaseOrderStore((s) => s.poItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);

    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<POFilters>({ status: '' });
    const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });

    const [printPoId, setPrintPoId] = useState<string>('');
    const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);

    // Toast state
    const [toast, setToast] = useState<string>('');
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Receive Goods modal state
    const [receiveModalOpen, setReceiveModalOpen] = useState(false);
    const [receivePoData, setReceivePoData] = useState<any>(null);
    const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
    const [receiveLoading, setReceiveLoading] = useState(false);

    const filteredData = useMemo(() => {
        return purchaseOrders.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            const matchesSearch =
                (item.id || '').toLowerCase().includes(keyword) ||
                (item.vendorName || '').toLowerCase().includes(keyword);
            const matchesStatus = filters.status ? item.status === filters.status : true;
            // In receiving mode, only show POs that can actually be received.
            const matchesReceivable = receivingMode
                ? (item.status === 'Approved' || item.status === 'Billed')
                : true;

            let matchesDate = true;
            if (dateRange.from) matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
            if (dateRange.to)   matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);

            return matchesSearch && matchesStatus && matchesReceivable && matchesDate;
        });
    }, [purchaseOrders, searchTerm, filters.status, dateRange.from, dateRange.to, receivingMode]);

    const activePrintPo = filteredData.find((po) => po.id === printPoId)
        || purchaseOrders.find((po) => po.id === printPoId)
        || null;
    const activeVendorName = activePrintPo?.vendorName || '-';
    const activePrintLines = activePrintPo ? (poItemTemplates[activePrintPo.id] || []) : [];

    const queuePrintPo = useCallback((poId: string) => {
        setPrintPoId(poId);
        setIsPreviewOpen(true);
    }, []);

    // Submit for Approval
    const handleSubmitApproval = useCallback(async (row: Record<string, unknown>) => {
        try {
            await api.post(`/api/v1/purchase-orders/${row['_id'] as string}/submit-approval`);
            setToast('Submitted for approval');
            queryClient.invalidateQueries({ queryKey: AP_KEYS.pos });
        } catch (err) {
            setToast('Failed to submit for approval');
        }
    }, [queryClient]);

    // Open Receive Goods modal
    const handleOpenReceive = useCallback(async (row: Record<string, unknown>) => {
        try {
            const res = await api.get<any>(`/api/v1/purchase-orders/${row['_id'] as string}`);
            const po = res.data ?? res;
            setReceivePoData(po);
            const lines: ReceiveLine[] = (po.lines ?? []).map((line: any) => ({
                purchaseOrderLineId: line._id,
                qtyReceived: Math.max(0, (line.quantity ?? 0) - (line.receivedQty ?? 0)),
            }));
            setReceiveLines(lines);
            setReceiveModalOpen(true);
        } catch (err) {
            setToast('Failed to load PO details');
        }
    }, []);

    // Submit Receive Goods
    const handleReceiveSubmit = useCallback(async () => {
        if (!receivePoData) return;
        setReceiveLoading(true);
        try {
            const res = await api.post<any>(`/api/v1/purchase-orders/${receivePoData._id}/receive`, {
                lines: receiveLines,
                notes: '',
            });
            const billNumber = res.data?.billNumber ?? res.billNumber ?? '';
            setReceiveModalOpen(false);
            setReceivePoData(null);
            setReceiveLines([]);
            setToast(`Bill created: ${billNumber}`);
            queryClient.invalidateQueries({ queryKey: AP_KEYS.pos });
            navigate('/ap/bills');
        } catch (err) {
            setToast('Failed to receive goods');
        } finally {
            setReceiveLoading(false);
        }
    }, [receivePoData, receiveLines, queryClient, navigate]);

    // Close PO
    const handleClosePO = useCallback(async (row: Record<string, unknown>) => {
        if (!window.confirm(`Close PO ${row['id'] as string}? This action cannot be undone.`)) return;
        try {
            await api.post(`/api/v1/purchase-orders/${row['_id'] as string}/close`);
            setToast('PO closed');
            queryClient.invalidateQueries({ queryKey: AP_KEYS.pos });
        } catch (err) {
            setToast('Failed to close PO');
        }
    }, [queryClient]);

    const columns = [
        { key: 'id', label: 'PO #', sortable: true },
        { key: 'vendorName', label: 'Vendor', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'expectedDate', label: 'Expected', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'amount', label: 'Total', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Closed' ? 'Success' : (val as string)} label={val as string} /> },
        {
            key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => {
                const status = row['status'] as string;
                const isClosed = status === 'Closed' || status === 'Cancelled';
                const canReceive = status === 'Approved' || status === 'Billed';
                const isDraft = status === 'Draft';
                return (
                    <div className="flex gap-1.5 justify-end flex-wrap">
                        <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); navigate(`/ap/pos/edit?poId=${row['id'] as string}&mode=view`); }} />
                        <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(event: React.MouseEvent) => { event.stopPropagation(); navigate(`/ap/pos/edit?poId=${row['id'] as string}&mode=edit`); }} />
                        <Button text="Print" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); queuePrintPo(row['id'] as string); }} />
                        {isDraft && (
                            <Button
                                text="Submit"
                                size="small"
                                variant="secondary"
                                onClick={(event: React.MouseEvent) => { event.stopPropagation(); handleSubmitApproval(row); }}
                            />
                        )}
                        {canReceive && (
                            <Button
                                text="Receive"
                                size="small"
                                variant="primary"
                                onClick={(event: React.MouseEvent) => { event.stopPropagation(); handleOpenReceive(row); }}
                            />
                        )}
                        {!isClosed && (
                            <Button
                                text="Close"
                                size="small"
                                variant="danger"
                                onClick={(event: React.MouseEvent) => { event.stopPropagation(); handleClosePO(row); }}
                            />
                        )}
                    </div>
                );
            }
        }
    ];

    return (
        <div className="max-w-full mx-auto">
            {/* Toast notification */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[100] bg-neutral-900 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium transition-opacity duration-300">
                    {toast}
                </div>
            )}

            {/* Receive Goods Modal */}
            {receiveModalOpen && receivePoData && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
                        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Receive Goods</h2>
                        <p className="text-sm text-neutral-500 mb-4">
                            PO #{receivePoData.poNumber ?? receivePoData.id} &mdash; {receivePoData.vendorName ?? ''}
                        </p>
                        <div className="overflow-x-auto mb-4">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="bg-neutral-50 border-b border-neutral-200">
                                        <th className="text-left px-3 py-2 font-medium text-neutral-600">Description</th>
                                        <th className="text-right px-3 py-2 font-medium text-neutral-600">Ordered</th>
                                        <th className="text-right px-3 py-2 font-medium text-neutral-600">Already Received</th>
                                        <th className="text-right px-3 py-2 font-medium text-neutral-600 w-32">Qty to Receive</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(receivePoData.lines ?? []).map((line: any, idx: number) => (
                                        <tr key={line._id ?? idx} className="border-b border-neutral-100 last:border-0">
                                            <td className="px-3 py-2 text-neutral-800">{line.description ?? line.itemName ?? '-'}</td>
                                            <td className="px-3 py-2 text-right text-neutral-700">{line.quantity ?? 0}</td>
                                            <td className="px-3 py-2 text-right text-neutral-700">{line.receivedQty ?? 0}</td>
                                            <td className="px-3 py-2 text-right">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={Math.max(0, (line.quantity ?? 0) - (line.receivedQty ?? 0))}
                                                    className="w-24 text-right border border-neutral-300 rounded-md px-2 py-1 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                                    value={receiveLines[idx]?.qtyReceived ?? 0}
                                                    onChange={(e) => {
                                                        const val = Math.max(0, Number(e.target.value));
                                                        setReceiveLines((prev) => {
                                                            const updated = [...prev];
                                                            updated[idx] = { ...updated[idx], qtyReceived: val };
                                                            return updated;
                                                        });
                                                    }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button
                                text="Cancel"
                                variant="tertiary"
                                onClick={() => {
                                    setReceiveModalOpen(false);
                                    setReceivePoData(null);
                                    setReceiveLines([]);
                                }}
                                disabled={receiveLoading}
                            />
                            <Button
                                text={receiveLoading ? 'Saving...' : 'Confirm Receipt'}
                                variant="primary"
                                onClick={handleReceiveSubmit}
                                disabled={receiveLoading}
                            />
                        </div>
                    </div>
                </div>
            )}

            {receivingMode && (
                <div className="mb-4">
                    <h1 className="text-xl font-semibold text-neutral-900">Receive Goods</h1>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        Approved purchase orders awaiting receipt. Click <span className="font-medium">Receive</span> to record quantities received and generate a draft bill.
                    </p>
                </div>
            )}

            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    {!receivingMode && (
                    <button
                        className="border border-[#b9ddff] bg-[#e8f4ff] text-primary-700 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => {
                            setSearchTerm('');
                            setFilters({ status: '' });
                            setDateRange({ from: '', to: '' });
                        }}
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    )}
                    {!receivingMode && (
                    <button
                        className={`border border-primary-700 bg-primary-700 text-neutral-0 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold ${canCreate ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                        onClick={() => navigate('/ap/pos/new')}
                        disabled={!canCreate}
                    >
                        <Plus size={16} />
                        New PO
                    </button>
                    )}
                    <button
                        className="btn btn-secondary flex items-center gap-1"
                        title="Export CSV"
                        onClick={() => {
                            const rows = filteredData.map((po) => ({
                                id: po.id,
                                vendorName: po.vendorName || '',
                                date: po.date,
                                amount: po.amount || 0,
                                status: po.status,
                            }));
                            exportToCsv('purchase-orders.csv', rows, [
                                { label: 'Number', key: 'id' },
                                { label: 'Vendor', key: 'vendorName' },
                                { label: 'Date', key: 'date' },
                                { label: 'Amount', key: 'amount' },
                                { label: 'Status', key: 'status' },
                            ]);
                        }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_170px_170px_auto] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search PO # or vendor..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.status}
                        onChange={(event) => setFilters({ status: event.target.value })}
                    >
                        <option value="">Filter by Status</option>
                        <option value="Draft">Draft</option>
                        <option value="Pending Approval">Pending Approval</option>
                        <option value="Approved">Approved</option>
                        <option value="Billed">Billed</option>
                        <option value="Closed">Closed</option>
                    </select>
                </div>
                <div className="min-w-0">
                    <input
                        type="date"
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={dateRange.from}
                        onChange={(event) => setDateRange((prev) => ({ ...prev, from: event.target.value }))}
                    />
                </div>
                <div className="min-w-0">
                    <input
                        type="date"
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={dateRange.to}
                        onChange={(event) => setDateRange((prev) => ({ ...prev, to: event.target.value }))}
                    />
                </div>
                {(dateRange.from || dateRange.to) && (
                    <Button
                        text="Clear"
                        variant="tertiary"
                        size="small"
                        className="justify-self-end"
                        onClick={() => setDateRange({ from: '', to: '' })}
                    />
                )}
            </div>

            <Card padding={false}>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={filteredData as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => navigate(`/ap/pos/edit?poId=${row['id'] as string}&mode=view`)}
                    showCount
                    countLabel="orders"
                    isLoading={isLoading}
                    loadingLabel="Loading purchase orders..."
                />
            </Card>

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Purchase Order Print Preview"
                documentTitle={`PurchaseOrder_${activePrintPo?.id || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                {activePrintPo && (
                    // casts: PurchaseOrder/POItem/CompanyInfo lack index signatures required by print template
                    <PurchaseOrderPrintTemplate
                        purchaseOrder={activePrintPo as unknown as Record<string, unknown>}
                        lineItems={activePrintLines as unknown as Record<string, unknown>[]}
                        vendorName={activeVendorName}
                        company={company as unknown as Record<string, unknown>}
                        options={printSettings}
                    />
                )}
            </PrintPreviewModal>
        </div>
    );
};

export default PurchaseOrders;
