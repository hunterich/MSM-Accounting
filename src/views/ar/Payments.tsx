import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import { Search, FileText, Paperclip, MoreHorizontal, Trash2, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useARPayments } from '../../hooks/useAR';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { useModulePermissions } from '../../hooks/useModulePermissions';

interface PaymentFilters {
    status: string;
}

interface DateRange {
    from: string;
    to: string;
}

interface FilterOption {
    value: string;
    label: string;
}

interface FilterConfig {
    key: string;
    label: string;
    options: FilterOption[];
}

const Payments = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit, canDelete } = useModulePermissions('ar_payments');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<PaymentFilters>({ status: '' });
    const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });
    const [detailTab, setDetailTab] = useState<string>('summary');

    const { data: paymentsResult, isLoading } = useARPayments();
    const payments = paymentsResult?.data ?? [];

    // Tab state managed by useDocumentTabs
    const { selectedId: selectedPaymentId, openIds: openPaymentIds, openTab: openPaymentTab, closeTab: closePaymentTab, tabRows } = useDocumentTabs({ urlParam: 'paymentId' });

    const filteredData = useMemo(() => {
        return payments.filter(item => {
            const matchesSearch = item.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || item.invoiceId.toLowerCase().includes(searchTerm.toLowerCase()) || item.id.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filters.status ? item.status === filters.status : true;

            let matchesDate = true;
            if (dateRange.from) {
                matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
            }
            if (dateRange.to) {
                matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
            }

            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [searchTerm, filters, payments, dateRange]);

    const columns = [
        { key: 'id', label: 'Payment #' },
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceId', label: 'Invoice Ref' },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Completed' ? 'Success' : 'Warning'} label={val as string} /> },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openPaymentTab(row['id'] as string); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate('/ar/payments/edit', { state: { mode: 'edit', paymentId: row['id'] as string } }); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); alert('Print is not connected yet.'); }} />
                </div>
            )
        }
    ];

    const selectedPayment = payments.find((item) => item.id === selectedPaymentId) || null;
    const linkedInvoice = null;   // Invoice detail fetching not wired yet
    const linkedBank = null;      // Bank account lookup not wired yet

    const filterOptions: FilterConfig[] = [
        {
            key: 'status',
            label: 'Filter by Status',
            options: [
                { value: 'Completed', label: 'Completed' },
                { value: 'Processing', label: 'Processing' }
            ]
        }
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((p) => ({
            id: p.id,
            date: p.date,
            customerName: p.customerName,
            method: p.method,
            amount: p.amount,
            status: p.status,
        }));
        exportToCsv('ar-payments.csv', rows, [
            { label: 'Number', key: 'id' },
            { label: 'Date', key: 'date' },
            { label: 'Customer', key: 'customerName' },
            { label: 'Method', key: 'method' },
            { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Customer Payments"
                subtitle="Record and track incoming payments against invoices."
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
                openIds={openPaymentIds}
                selectedId={selectedPaymentId}
                tabRows={tabRows}
                getLabel={(id) => payments.find((p) => p.id === id)?.id || id}
                onSelect={openPaymentTab}
                onClose={closePaymentTab}
                newTabLabel="Record Payment"
                onNewTab={canCreate ? () => navigate('/ar/payments/new', { state: { mode: 'create' } }) : undefined}
                disableNew={!canCreate}
                onCatalog={() => {
                    setSearchTerm('');
                    setFilters({ status: '' });
                    setDateRange({ from: '', to: '' });
                }}
                firstRowSuffix={
                    <div className="workbench-tab-count">Open tabs: {openPaymentIds.length}</div>
                }
            />

            {!selectedPayment && (
                <>
                    <div className="payments-filter-card">
                        <div className="payments-filter-search">
                            <Search size={18} />
                            <input
                                type="text"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                placeholder="Search payment # or customer..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="payments-filter-field">
                            <select
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={filters.status}
                                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                            >
                                <option value="">{filterOptions[0].label}</option>
                                {filterOptions[0].options.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="payments-filter-field">
                            <input
                                type="date"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={dateRange.from}
                                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                            />
                        </div>
                        <div className="payments-filter-field">
                            <input
                                type="date"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={dateRange.to}
                                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                            />
                        </div>
                        {(dateRange.from || dateRange.to) && (
                            <Button
                                text="Clear"
                                variant="tertiary"
                                size="small"
                                className="payments-filter-clear"
                                onClick={() => setDateRange({ from: '', to: '' })}
                            />
                        )}
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

            {selectedPayment && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedPayment.id}</h2>
                            <StatusTag status={selectedPayment.status === 'Completed' ? 'Success' : 'Warning'} label={selectedPayment.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => alert('Print is not connected yet.')} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ar/payments/edit', { state: { mode: 'edit', paymentId: selectedPayment.id } })} />
                        </div>
                    </div>

                    <div className="dense-header-grid">
                        <div className="dense-field">
                            <label>Customer</label>
                            <div>{selectedPayment.customerName}</div>
                        </div>
                        <div className="dense-field">
                            <label>Payment Date</label>
                            <div>{formatDateID(selectedPayment.date)}</div>
                        </div>
                        <div className="dense-field">
                            <label>Method</label>
                            <div>{selectedPayment.method}</div>
                        </div>
                        <div className="dense-field">
                            <label>Deposit To</label>
                            {/* linkedBank is null until wired up */}
                            <div>{(linkedBank as { name?: string } | null)?.name || '-'}</div>
                        </div>
                        <div className="dense-amount">
                            {formatIDR(selectedPayment.amount)}
                        </div>
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
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Payment #</label><strong>{selectedPayment.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedPayment.status === 'Completed' ? 'Success' : 'Warning'} label={selectedPayment.status} /></div>
                                        <div className="detail-field"><label>Customer</label><div>{selectedPayment.customerName}</div></div>
                                        <div className="detail-field"><label>Method</label><div>{selectedPayment.method}</div></div>
                                        <div className="detail-field"><label>Date</label><div>{formatDateID(selectedPayment.date)}</div></div>
                                        <div className="detail-field"><label>Total</label><strong>{formatIDR(selectedPayment.amount)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'items' && (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table">
                                            <thead>
                                                <tr>
                                                    <th>Invoice #</th>
                                                    <th>Date</th>
                                                    <th className="text-right">Amount</th>
                                                    <th>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>{selectedPayment.invoiceId}</td>
                                                    {/* linkedInvoice is null until wired up */}
                                                    <td>{(linkedInvoice as { date?: string } | null) ? formatDateID((linkedInvoice as unknown as { date: string }).date) : '-'}</td>
                                                    <td className="text-right">{formatIDR(selectedPayment.amount)}</td>
                                                    <td>{(linkedInvoice as { status?: string } | null) ? (linkedInvoice as unknown as { status: string }).status : '-'}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Payment Date</label><strong>{formatDateID(selectedPayment.date)}</strong></div>
                                        <div className="detail-field"><label>Method</label><strong>{selectedPayment.method}</strong></div>
                                        <div className="detail-field"><label>Deposit To</label><div>{(linkedBank as { name?: string } | null)?.name || '-'}</div></div>
                                        <div className="detail-field"><label>Linked Invoice</label><div>{selectedPayment.invoiceId}</div></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && (
                                    <div className="attachment-empty">No attachments.</div>
                                )}
                                {detailTab === 'audit' && (
                                    <ul className="audit-list">
                                        <li>
                                            <div><strong>Payment recorded</strong></div>
                                            <div>{formatDateID(selectedPayment.date)} • System</div>
                                        </li>
                                        <li>
                                            <div><strong>AR cleared against invoice {selectedPayment.invoiceId}</strong></div>
                                            <div>{formatDateID(selectedPayment.date)} • Auto journal</div>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        </div>
                        <div className="dense-side-actions">
                            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                            <button className="dense-side-btn" title="Attachment"><Paperclip size={18} /></button>
                            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                            <button className={`dense-side-btn danger ${canDelete ? '' : 'opacity-60 cursor-not-allowed'}`} title="Delete" disabled={!canDelete}><Trash2 size={18} /></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Payments;
