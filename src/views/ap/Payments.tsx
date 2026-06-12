import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search, List, X, FileText, Paperclip, MoreHorizontal, Trash2, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { useAPPayments, useUpdateAPPayment } from '../../hooks/useAP';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useSettingsStore } from '../../stores/useSettingsStore';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import PaymentReceiptPrintTemplate from '../../components/print/PaymentReceiptPrintTemplate';

interface PaymentFilters {
    status: string;
}

interface DateRange {
    from: string;
    to: string;
}

const Payments = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit, canDelete } = useModulePermissions('ap_payments');

    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<PaymentFilters>({ status: '' });
    const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });
    const [openPaymentIds, setOpenPaymentIds] = useState<string[]>([]);
    const [selectedPaymentId, setSelectedPaymentId] = useState<string>('');
    const [detailTab, setDetailTab] = useState<string>('summary');
    const { data: paymentsResult, isLoading } = useAPPayments();
    const updateAPPayment = useUpdateAPPayment();
    const payments = paymentsResult?.data ?? [];

    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [printPaymentId, setPrintPaymentId] = useState<string>('');
    const [isPrintOpen, setIsPrintOpen] = useState<boolean>(false);
    const queuePrintPayment = (id: string) => { setPrintPaymentId(id); setIsPrintOpen(true); };
    const activePrintPayment = payments.find((p) => p.id === printPaymentId) || null;

    const filteredData = useMemo(() => {
        return payments.filter((item) => {
            const vendorName = (item.vendorName || '').toLowerCase();
            const billId = (item.billId || '').toLowerCase();
            const paymentId = (item.id || '').toLowerCase();
            const keyword = searchTerm.toLowerCase();
            const matchesSearch =
                paymentId.includes(keyword) ||
                vendorName.includes(keyword) ||
                billId.includes(keyword);
            const matchesStatus = filters.status ? item.status === filters.status : true;

            let matchesDate = true;
            if (dateRange.from) matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
            if (dateRange.to) matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [searchTerm, filters.status, dateRange.from, dateRange.to, payments]);

    const selectedPayment = payments.find((item) => item.id === selectedPaymentId) || null;
    const linkedBill = null;  // Bill detail not wired yet
    const linkedBank = null;  // Bank lookup not wired yet

    const openPaymentTab = (paymentId: string) => {
        setOpenPaymentIds((prev) => (prev.includes(paymentId) ? prev : [...prev, paymentId]));
        setSelectedPaymentId(paymentId);
        setDetailTab('summary');
    };

    const closePaymentTab = (paymentId: string) => {
        setOpenPaymentIds((prev) => {
            const idx = prev.indexOf(paymentId);
            const next = prev.filter((id) => id !== paymentId);
            if (selectedPaymentId === paymentId) {
                if (next.length === 0) {
                    setSelectedPaymentId('');
                } else {
                    const fallback = next[Math.max(0, idx - 1)] || next[0];
                    setSelectedPaymentId(fallback);
                }
            }
            return next;
        });
    };

    const columns = [
        { key: 'id', label: 'Payment #' },
        { key: 'date', label: 'Date', render: (value: unknown) => formatDateID(value as string) },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'billId', label: 'Bill Ref' },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (value: unknown) => formatIDR(value as number) },
        {
            key: 'status',
            label: 'Status',
            render: (value: unknown) => (
                <StatusTag status={(value as string) === 'Completed' ? 'Success' : 'Warning'} label={value as string} />
            )
        },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    {row['status'] === 'Draft' && (
                        <Button
                            text="Complete"
                            size="small"
                            variant="primary"
                            disabled={!canEdit || updateAPPayment.isPending}
                            onClick={(event: React.MouseEvent) => { event.stopPropagation(); updateAPPayment.mutate({ id: (row['_id'] || row['id']) as string, status: 'Completed' }); }}
                        />
                    )}
                    <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); openPaymentTab(row['id'] as string); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(event: React.MouseEvent) => { event.stopPropagation(); navigate('/ap/payments/edit', { state: { mode: 'edit', paymentId: row['id'] as string } }); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); queuePrintPayment(row['id'] as string); }} />
                </div>
            )
        }
    ];

    const firstRowDynamicLimit = 3;
    const firstRowPaymentIds = openPaymentIds.slice(0, firstRowDynamicLimit);
    const remainingPaymentIds = openPaymentIds.slice(firstRowDynamicLimit);
    const extraRows: string[][] = [];
    for (let i = 0; i < remainingPaymentIds.length; i += 5) {
        extraRows.push(remainingPaymentIds.slice(i, i + 5));
    }

    const renderPaymentTab = (paymentId: string) => {
        const payment = payments.find((item) => item.id === paymentId);
        if (!payment) return null;
        const isActive = paymentId === selectedPaymentId;
        return (
            <button
                key={paymentId}
                className={`workbench-doc-tab ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedPaymentId(paymentId)}
            >
                {payment.id}
                <span className="workbench-doc-tab-close" onClick={(event) => { event.stopPropagation(); closePaymentTab(paymentId); }}>
                    <X size={14} />
                </span>
            </button>
        );
    };

    return (
        <div className="container ap-module container-full-width">
            <div className="workbench-doc-tabs">
                <div className="workbench-doc-tab-row">
                    <button
                        className="workbench-doc-tab workbench-doc-tab-catalog"
                        onClick={() => {
                            setSearchTerm('');
                            setFilters({ status: '' });
                            setDateRange({ from: '', to: '' });
                            setSelectedPaymentId('');
                        }}
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    <button
                        className={`workbench-doc-tab workbench-doc-tab-new ${canCreate ? '' : 'opacity-60 cursor-not-allowed'}`}
                        onClick={() => navigate('/ap/payments/new', { state: { mode: 'create' } })}
                        disabled={!canCreate}
                    >
                        <Plus size={16} />
                        Pay Bills
                    </button>
                    {firstRowPaymentIds.map((paymentId) => renderPaymentTab(paymentId))}
                    <button
                        className="btn btn-secondary flex items-center gap-1"
                        title="Export CSV"
                        onClick={() => {
                            const rows = filteredData.map((p) => ({
                                id: p.id,
                                date: p.date,
                                vendorName: p.vendorName,
                                method: p.method,
                                amount: p.amount,
                                status: p.status,
                            }));
                            exportToCsv('ap-payments.csv', rows, [
                                { label: 'Number', key: 'id' },
                                { label: 'Date', key: 'date' },
                                { label: 'Vendor', key: 'vendorName' },
                                { label: 'Method', key: 'method' },
                                { label: 'Amount', key: 'amount' },
                                { label: 'Status', key: 'status' },
                            ]);
                        }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    <div className="workbench-tab-count">Open tabs: {openPaymentIds.length}</div>
                </div>
                {extraRows.map((row, rowIndex) => (
                    <div key={`ap-payment-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                        {row.map((paymentId) => renderPaymentTab(paymentId))}
                    </div>
                ))}
            </div>

            {!selectedPayment && (
                <>
                    <div className="payments-filter-card filter-4">
                        <div className="payments-filter-search">
                            <Search size={18} />
                            <input
                                type="text"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                placeholder="Search payment #, vendor, bill..."
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                            />
                        </div>
                        <div className="payments-filter-field">
                            <select className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={filters.status} onChange={(event) => setFilters({ status: event.target.value })}>
                                <option value="">Filter by Status</option>
                                <option value="Draft">Draft</option>
                                <option value="Completed">Completed</option>
                                <option value="Processing">Processing</option>
                            </select>
                        </div>
                        <div className="payments-filter-field">
                            <input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={dateRange.from} onChange={(event) => setDateRange((prev) => ({ ...prev, from: event.target.value }))} />
                        </div>
                        <div className="payments-filter-field">
                            <input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={dateRange.to} onChange={(event) => setDateRange((prev) => ({ ...prev, to: event.target.value }))} />
                        </div>
                        {(dateRange.from || dateRange.to) ? (
                            <Button text="Clear" variant="tertiary" size="small" className="payments-filter-clear" onClick={() => setDateRange({ from: '', to: '' })} />
                        ) : null}
                    </div>
                    <Card padding={false}>
                        <Table
                            columns={columns as TableColumn<Record<string, unknown>>[]}
                            data={filteredData as unknown as Record<string, unknown>[]}
                            onRowClick={(row) => openPaymentTab(row['id'] as string)}
                            showCount
                            countLabel="payments"
                            isLoading={isLoading}
                            loadingLabel="Loading payments..."
                        />
                    </Card>
                </>
            )}

            {selectedPayment ? (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedPayment.id}</h2>
                            <StatusTag status={selectedPayment.status === 'Completed' ? 'Success' : 'Warning'} label={selectedPayment.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintPayment(selectedPayment.id)} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ap/payments/edit', { state: { mode: 'edit', paymentId: selectedPayment.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field"><label>Vendor</label><div>{selectedPayment.vendorName}</div></div>
                        <div className="dense-field"><label>Date</label><div>{formatDateID(selectedPayment.date)}</div></div>
                        <div className="dense-field"><label>Method</label><div>{selectedPayment.method}</div></div>
                        <div className="dense-field"><label>Paid From</label><div>{(linkedBank as { name?: string } | null)?.name || '-'}</div></div>
                        <div className="dense-amount">{formatIDR(selectedPayment.amount)}</div>
                    </div>
                    <div className="dense-body">
                        <div className="dense-main">
                            <div className="detail-tabs dense-tabs">
                                <button className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                                <button className={`detail-tab ${detailTab === 'items' ? 'active' : ''}`} onClick={() => setDetailTab('items')}>Items</button>
                                <button className={`detail-tab ${detailTab === 'logistics' ? 'active' : ''}`} onClick={() => setDetailTab('logistics')}>Logistics</button>
                                <button className={`detail-tab ${detailTab === 'attachments' ? 'active' : ''}`} onClick={() => setDetailTab('attachments')}>Attachments</button>
                                <button className={`detail-tab ${detailTab === 'audit' ? 'active' : ''}`} onClick={() => setDetailTab('audit')}>Audit / Journal</button>
                            </div>
                            <div className="detail-tab-content dense-content">
                                {detailTab === 'summary' ? (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Payment #</label><strong>{selectedPayment.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedPayment.status === 'Completed' ? 'Success' : 'Warning'} label={selectedPayment.status} /></div>
                                        <div className="detail-field"><label>Vendor</label><div>{selectedPayment.vendorName}</div></div>
                                        <div className="detail-field"><label>Method</label><div>{selectedPayment.method}</div></div>
                                        <div className="detail-field"><label>Date</label><div>{formatDateID(selectedPayment.date)}</div></div>
                                        <div className="detail-field"><label>Total</label><strong>{formatIDR(selectedPayment.amount)}</strong></div>
                                    </div>
                                ) : null}
                                {detailTab === 'items' ? (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table compact">
                                            <thead>
                                                <tr>
                                                    <th>Bill</th>
                                                    <th>Date</th>
                                                    <th className="text-right">Amount</th>
                                                    <th>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>{selectedPayment.billId}</td>
                                                    <td>{(linkedBill as { date?: string } | null) ? formatDateID((linkedBill as unknown as { date: string }).date) : '-'}</td>
                                                    <td className="text-right">{formatIDR(selectedPayment.amount)}</td>
                                                    <td>{(linkedBill as { status?: string } | null)?.status || '-'}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}
                                {detailTab === 'logistics' ? (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Bank Account</label><strong>{(linkedBank as { name?: string } | null)?.name || '-'}</strong></div>
                                        <div className="detail-field"><label>Payment Method</label><strong>{selectedPayment.method}</strong></div>
                                        <div className="detail-field"><label>Bill Ref</label><div>{selectedPayment.billId}</div></div>
                                        <div className="detail-field"><label>Value Date</label><div>{formatDateID(selectedPayment.date)}</div></div>
                                    </div>
                                ) : null}
                                {detailTab === 'attachments' ? <div className="attachment-empty">No attachments.</div> : null}
                                {detailTab === 'audit' ? (
                                    <ul className="audit-list">
                                        <li><div><strong>AP payment recorded</strong></div><div>{formatDateID(selectedPayment.date)} • System</div></li>
                                        <li><div><strong>A/P cleared for bill {selectedPayment.billId}</strong></div><div>{formatDateID(selectedPayment.date)} • Auto journal</div></li>
                                    </ul>
                                ) : null}
                            </div>
                        </div>
                        <div className="dense-side-actions">
                            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                            <button className="dense-side-btn" title="Attachments"><Paperclip size={18} /></button>
                            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                            <button className={`dense-side-btn danger ${canDelete ? '' : 'opacity-60 cursor-not-allowed'}`} title="Delete" disabled={!canDelete}><Trash2 size={18} /></button>
                        </div>
                    </div>
                </div>
            ) : null}

            <PrintPreviewModal
                isOpen={isPrintOpen}
                onClose={() => setIsPrintOpen(false)}
                title="Payment Receipt Preview"
                documentTitle={`Receipt_${activePrintPayment?.number || activePrintPayment?.id || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                <PaymentReceiptPrintTemplate
                    payment={activePrintPayment}
                    direction="out"
                    partyName={activePrintPayment?.vendorName}
                    company={company}
                    options={printSettings}
                />
            </PrintPreviewModal>
        </div>
    );
};

export default Payments;
