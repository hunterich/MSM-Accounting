import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search, List, X, FileText, Paperclip, MoreHorizontal, Trash2, Loader } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useARPayments } from '../../hooks/useAR';

const Payments = () => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ status: '' });
    const [dateRange, setDateRange] = useState({ from: '', to: '' });
    const [selectedPaymentId, setSelectedPaymentId] = useState('');
    const [openPaymentIds, setOpenPaymentIds] = useState([]);
    const [detailTab, setDetailTab] = useState('summary');

    const { data: paymentsResult, isLoading } = useARPayments();
    const payments = paymentsResult?.data ?? [];

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
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceId', label: 'Invoice Ref' },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', align: 'right', render: (val) => formatIDR(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Completed' ? 'Success' : 'Warning'} label={val} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(e) => { e.stopPropagation(); openPaymentTab(row.id); }} />
                    <Button text="Edit" size="small" variant="tertiary" onClick={(e) => { e.stopPropagation(); navigate('/ar/payments/edit', { state: { mode: 'edit', paymentId: row.id } }); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(e) => { e.stopPropagation(); alert('Print is not connected yet.'); }} />
                </div>
            )
        }
    ];

    const selectedPayment = payments.find((item) => item.id === selectedPaymentId) || null;
    const linkedInvoice = null;   // Invoice detail fetching not wired yet
    const linkedBank    = null;   // Bank account lookup not wired yet

    const openPaymentTab = (paymentId) => {
        setOpenPaymentIds((prev) => (prev.includes(paymentId) ? prev : [...prev, paymentId]));
        setSelectedPaymentId(paymentId);
        setDetailTab('summary');
    };

    const closePaymentTab = (paymentId) => {
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

    const firstRowDynamicLimit = 3;
    const firstRowPaymentIds = openPaymentIds.slice(0, firstRowDynamicLimit);
    const remainingPaymentIds = openPaymentIds.slice(firstRowDynamicLimit);
    const extraRows = [];
    for (let i = 0; i < remainingPaymentIds.length; i += 5) {
        extraRows.push(remainingPaymentIds.slice(i, i + 5));
    }

    const renderPaymentTab = (paymentId) => {
        const payment = payments.find((item) => item.id === paymentId);
        if (!payment) return null;
        const isActive = paymentId === selectedPaymentId;
        return (
            <button key={paymentId} className={`workbench-doc-tab ${isActive ? 'active' : ''}`} onClick={() => setSelectedPaymentId(paymentId)}>
                {payment.id}
                <span className="workbench-doc-tab-close" onClick={(e) => { e.stopPropagation(); closePaymentTab(paymentId); }}>
                    <X size={14} />
                </span>
            </button>
        );
    };

    const filterOptions = [
        {
            key: 'status',
            label: 'Filter by Status',
            options: [
                { value: 'Completed', label: 'Completed' },
                { value: 'Processing', label: 'Processing' }
            ]
        }
    ];

    return (
        <div className="container ar-module container-full-width">
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
                        className="workbench-doc-tab workbench-doc-tab-new"
                        onClick={() => navigate('/ar/payments/new', { state: { mode: 'create' } })}
                    >
                        <Plus size={16} />
                        Record Payment
                    </button>
                    {firstRowPaymentIds.map((paymentId) => renderPaymentTab(paymentId))}
                    <div className="workbench-tab-count">Open tabs: {openPaymentIds.length}</div>
                </div>
                {extraRows.map((row, rowIndex) => (
                    <div key={`payment-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                        {row.map((paymentId) => renderPaymentTab(paymentId))}
                    </div>
                ))}
            </div>

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
                        {isLoading ? (
                            <div className="flex items-center gap-2 py-8 px-4 text-sm text-neutral-400">
                                <Loader size={16} className="animate-spin" /> Loading payments…
                            </div>
                        ) : (
                            <Table
                                columns={columns}
                                data={filteredData}
                                onRowClick={(row) => openPaymentTab(row.id)}
                                showCount
                                countLabel="payments"
                            />
                        )}
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
                            <Button text="Edit" size="small" variant="primary" onClick={() => navigate('/ar/payments/edit', { state: { mode: 'edit', paymentId: selectedPayment.id } })} />
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
                            <div>{linkedBank?.name || '-'}</div>
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
                                                    <td>{linkedInvoice ? formatDateID(linkedInvoice.date) : '-'}</td>
                                                    <td className="text-right">{formatIDR(selectedPayment.amount)}</td>
                                                    <td>{linkedInvoice ? linkedInvoice.status : '-'}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Payment Date</label><strong>{formatDateID(selectedPayment.date)}</strong></div>
                                        <div className="detail-field"><label>Method</label><strong>{selectedPayment.method}</strong></div>
                                        <div className="detail-field"><label>Deposit To</label><div>{linkedBank?.name || '-'}</div></div>
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
                            <button className="dense-side-btn danger" title="Delete"><Trash2 size={18} /></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Payments;
