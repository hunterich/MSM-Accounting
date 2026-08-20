// src/components/ap/purchaseorders/POListPane.tsx
// Purchase Orders catalog. views/ap/PurchaseOrders.tsx still exists but only
// serves /ap/receiving (Receive goods), which is a page module.
// POs have no separate detail — View/Edit open POFormV2 as a tab.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Card from '../../UI/Card';
import FilterBar from '../../UI/FilterBar';
import PageHeader from '../../Layout/PageHeader';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import PurchaseOrderPrintTemplate from '../../print/PurchaseOrderPrintTemplate';
import { exportToCsv } from '../../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { usePurchaseOrders, AP_KEYS } from '../../../hooks/useAP';
import { usePurchaseOrderStore } from '../../../stores/usePurchaseOrderStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { api } from '../../../api/apiClient';

interface ReceiveLine { purchaseOrderLineId: string; qtyReceived: number }

const POListPane = (): React.ReactElement => {
    const queryClient = useQueryClient();
    const { canCreate, canEdit } = useModulePermissions('ap_pos');
    const { open } = useWorkspaceNav();
    const { data: posResult, isLoading } = usePurchaseOrders();
    const purchaseOrders = useMemo(() => posResult?.data ?? [], [posResult?.data]);
    const poItemTemplates = usePurchaseOrderStore((s) => s.poItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);

    const [searchTerm, setSearchTerm] = useState('');
    const [status, setStatus] = useState('');
    const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
    const [printPoId, setPrintPoId] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [toast, setToast] = useState('');
    useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); } }, [toast]);

    const [receiveModalOpen, setReceiveModalOpen] = useState(false);
    const [receivePoData, setReceivePoData] = useState<any>(null);
    const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
    const [receiveLoading, setReceiveLoading] = useState(false);

    const openForm = (id: string) => open({ kind: 'doc-form', target: { module: 'ap', entity: 'purchase-order', recordId: id, mode: 'edit' }, title: id, path: `/ap/pos/edit?poId=${id}&mode=view` });
    const openNew = () => open({ kind: 'doc-form', target: { module: 'ap', entity: 'purchase-order', recordId: null, mode: 'create' }, title: 'New PO', path: '/ap/pos/new', unique: true });

    const filteredData = useMemo(() => purchaseOrders.filter((item) => {
        const kw = searchTerm.toLowerCase();
        const matchesSearch = (item.id || '').toLowerCase().includes(kw) || (item.vendorName || '').toLowerCase().includes(kw);
        const matchesStatus = status ? item.status === status : true;
        let matchesDate = true;
        if (dateRange.from) matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
        if (dateRange.to) matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
        return matchesSearch && matchesStatus && matchesDate;
    }), [purchaseOrders, searchTerm, status, dateRange]);

    const activePrintPo = purchaseOrders.find((po) => po.id === printPoId) || null;
    const activePrintLines = activePrintPo ? (poItemTemplates[activePrintPo.id] || []) : [];

    const handleSubmitApproval = useCallback(async (row: Record<string, unknown>) => {
        try { await api.post(`/api/v1/purchase-orders/${row['_id'] as string}/submit-approval`); setToast('Submitted for approval'); queryClient.invalidateQueries({ queryKey: AP_KEYS.pos }); }
        catch { setToast('Failed to submit for approval'); }
    }, [queryClient]);
    const handleOpenReceive = useCallback(async (row: Record<string, unknown>) => {
        try {
            const res = await api.get<any>(`/api/v1/purchase-orders/${row['_id'] as string}`);
            const po = res.data ?? res;
            setReceivePoData(po);
            setReceiveLines((po.lines ?? []).map((line: any) => ({ purchaseOrderLineId: line._id, qtyReceived: Math.max(0, (line.quantity ?? 0) - (line.receivedQty ?? 0)) })));
            setReceiveModalOpen(true);
        } catch { setToast('Failed to load PO details'); }
    }, []);
    const handleReceiveSubmit = useCallback(async () => {
        if (!receivePoData) return;
        setReceiveLoading(true);
        try {
            const res = await api.post<any>(`/api/v1/purchase-orders/${receivePoData._id}/receive`, { lines: receiveLines, notes: '' });
            const billNumber = res.data?.billNumber ?? res.billNumber ?? '';
            setReceiveModalOpen(false); setReceivePoData(null); setReceiveLines([]);
            setToast(`Bill created: ${billNumber}`); queryClient.invalidateQueries({ queryKey: AP_KEYS.pos });
        } catch { setToast('Failed to receive goods'); } finally { setReceiveLoading(false); }
    }, [receivePoData, receiveLines, queryClient]);
    const handleClosePO = useCallback(async (row: Record<string, unknown>) => {
        if (!window.confirm(`Close PO ${row['id'] as string}? This action cannot be undone.`)) return;
        try { await api.post(`/api/v1/purchase-orders/${row['_id'] as string}/close`); setToast('PO closed'); queryClient.invalidateQueries({ queryKey: AP_KEYS.pos }); }
        catch { setToast('Failed to close PO'); }
    }, [queryClient]);

    const columns = [
        { key: 'id', label: 'PO #', sortable: true },
        { key: 'vendorName', label: 'Vendor', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'expectedDate', label: 'Expected', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'amount', label: 'Total', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Closed' ? 'Success' : (val as string)} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => {
            const s = row['status'] as string;
            const isClosed = s === 'Closed' || s === 'Cancelled';
            const canReceive = s === 'Approved' || s === 'Billed';
            const isDraft = s === 'Draft';
            return (
                <div className="flex gap-1.5 justify-end flex-wrap">
                    <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openForm(row['id'] as string); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); openForm(row['id'] as string); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPrintPoId(row['id'] as string); setIsPreviewOpen(true); }} />
                    {isDraft && <Button text="Submit" size="small" variant="secondary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleSubmitApproval(row); }} />}
                    {canReceive && <Button text="Receive" size="small" variant="primary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleOpenReceive(row); }} />}
                    {!isClosed && <Button text="Close" size="small" variant="danger" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleClosePO(row); }} />}
                </div>
            );
        } },
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((po) => ({ id: po.id, vendorName: po.vendorName || '', date: po.date, amount: po.amount || 0, status: po.status }));
        exportToCsv('purchase-orders.csv', rows, [
            { label: 'Number', key: 'id' }, { label: 'Vendor', key: 'vendorName' }, { label: 'Date', key: 'date' },
            { label: 'Amount', key: 'amount' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ap-module container-full-width">
            {toast && <div className="fixed bottom-6 right-6 z-[100] bg-neutral-900 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium">{toast}</div>}

            {receiveModalOpen && receivePoData && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
                        <h2 className="text-lg font-semibold text-neutral-900 mb-1">Receive Goods</h2>
                        <p className="text-sm text-neutral-500 mb-4">PO #{receivePoData.poNumber ?? receivePoData.id} &mdash; {receivePoData.vendorName ?? ''}</p>
                        <div className="overflow-x-auto mb-4">
                            <table className="w-full text-sm border-collapse">
                                <thead><tr className="bg-neutral-50 border-b border-neutral-200">
                                    <th className="text-left px-3 py-2 font-medium text-neutral-600">Description</th>
                                    <th className="text-right px-3 py-2 font-medium text-neutral-600">Ordered</th>
                                    <th className="text-right px-3 py-2 font-medium text-neutral-600">Already Received</th>
                                    <th className="text-right px-3 py-2 font-medium text-neutral-600 w-32">Qty to Receive</th>
                                </tr></thead>
                                <tbody>
                                    {(receivePoData.lines ?? []).map((line: any, idx: number) => (
                                        <tr key={line._id ?? idx} className="border-b border-neutral-100 last:border-0">
                                            <td className="px-3 py-2 text-neutral-800">{line.description ?? line.itemName ?? '-'}</td>
                                            <td className="px-3 py-2 text-right text-neutral-700">{line.quantity ?? 0}</td>
                                            <td className="px-3 py-2 text-right text-neutral-700">{line.receivedQty ?? 0}</td>
                                            <td className="px-3 py-2 text-right">
                                                <input type="number" min={0} max={Math.max(0, (line.quantity ?? 0) - (line.receivedQty ?? 0))} className="w-24 text-right border border-neutral-300 rounded-md px-2 py-1 text-sm focus:border-primary-500 focus:outline-0"
                                                    value={receiveLines[idx]?.qtyReceived ?? 0}
                                                    onChange={(e) => { const v = Math.max(0, Number(e.target.value)); setReceiveLines((prev) => { const u = [...prev]; u[idx] = { ...u[idx], qtyReceived: v }; return u; }); }} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button text="Cancel" variant="tertiary" onClick={() => { setReceiveModalOpen(false); setReceivePoData(null); setReceiveLines([]); }} disabled={receiveLoading} />
                            <Button text={receiveLoading ? 'Saving...' : 'Confirm Receipt'} variant="primary" onClick={handleReceiveSubmit} disabled={receiveLoading} />
                        </div>
                    </div>
                </div>
            )}

            <PageHeader
                title="Purchase orders"
                subtitle="Vendor orders, receipts, and approval status."
                actions={
                    <div className="flex gap-2">
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="New PO" size="small" onClick={openNew} />}
                    </div>
                }
            />

            <FilterBar
                onSearch={setSearchTerm}
                filters={[{
                    key: 'status',
                    label: 'Status',
                    options: [
                        { value: 'Draft', label: 'Draft' },
                        { value: 'Pending Approval', label: 'Pending Approval' },
                        { value: 'Approved', label: 'Approved' },
                        { value: 'Billed', label: 'Billed' },
                        { value: 'Closed', label: 'Closed' },
                    ],
                }]}
                activeFilters={{ status }}
                onFilterChange={(_key, val) => setStatus(val)}
                placeholder="Search PO # or vendor..."
                extra={
                    <>
                        <label className={`acc-chip ${dateRange.from ? 'on' : ''}`}>
                            <span className="acc-chip-label">From:</span>
                            <input type="date" className="border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none" value={dateRange.from} onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))} aria-label="From date" />
                        </label>
                        <label className={`acc-chip ${dateRange.to ? 'on' : ''}`}>
                            <span className="acc-chip-label">To:</span>
                            <input type="date" className="border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none" value={dateRange.to} onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))} aria-label="To date" />
                        </label>
                        {(dateRange.from || dateRange.to) && (
                            <button type="button" className="acc-tool-btn" onClick={() => setDateRange({ from: '', to: '' })}>Clear</button>
                        )}
                    </>
                }
            />

            <Card padding={false}>
                <Table columns={columns as TableColumn<Record<string, unknown>>[]} data={filteredData as unknown as Record<string, unknown>[]} onRowClick={(row) => openForm(row['id'] as string)} showCount countLabel="orders" isLoading={isLoading} loadingLabel="Loading purchase orders..." />
            </Card>

            <PrintPreviewModal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Purchase Order Print Preview" documentTitle={`PurchaseOrder_${activePrintPo?.id || ''}`} defaultPaperSize={printSettings.defaultPaperSize}>
                {activePrintPo && <PurchaseOrderPrintTemplate purchaseOrder={activePrintPo as unknown as Record<string, unknown>} lineItems={activePrintLines as unknown as Record<string, unknown>[]} vendorName={activePrintPo?.vendorName || '-'} company={company as unknown as Record<string, unknown>} options={printSettings} />}
            </PrintPreviewModal>
        </div>
    );
};

export default POListPane;
