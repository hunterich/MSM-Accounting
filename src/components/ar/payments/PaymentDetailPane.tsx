// src/components/ar/payments/PaymentDetailPane.tsx
// Workspace-native AR payment detail (one tab per payment).
import React, { useMemo, useState } from 'react';
import { FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import PaymentReceiptPrintTemplate from '../../print/PaymentReceiptPrintTemplate';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useARPayments } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';

interface Props { paymentId: string; workspaceTabId: string }

const PaymentDetailPane = ({ paymentId }: Props): React.ReactElement => {
    const { canEdit, canDelete } = useModulePermissions('ar_payments');
    const { open } = useWorkspaceNav();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const { data: paymentsResult } = useARPayments();
    const payment = useMemo(() => (paymentsResult?.data ?? []).find((p) => p.id === paymentId) ?? null, [paymentsResult?.data, paymentId]);
    const [detailTab, setDetailTab] = useState('summary');
    const [isPrintOpen, setIsPrintOpen] = useState(false);

    if (!payment) return <div className="p-6 text-sm text-neutral-500">Payment not found.</div>;

    const openEdit = () => open({ kind: 'doc-form', target: { module: 'ar', entity: 'payment', recordId: payment.id, mode: 'edit' }, title: `Edit ${payment.id}`, path: `/ar/payments/edit?paymentId=${payment.id}` });

    return (
        <div className="container ar-module container-full-width">
            <div className="invoice-workbench-card dense-mode">
                <div className="dense-topbar">
                    <div className="detail-header-title">
                        <h2 className="detail-header-h2">{payment.id}</h2>
                        <StatusTag status={payment.status === 'Completed' ? 'Success' : 'Warning'} label={payment.status} />
                    </div>
                    <div className="detail-header-actions">
                        <Button text="Print" size="small" variant="secondary" onClick={() => setIsPrintOpen(true)} />
                        <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={openEdit} />
                    </div>
                </div>

                <div className="dense-header-grid">
                    <div className="dense-field"><label>Customer</label><div>{payment.customerName}</div></div>
                    <div className="dense-field"><label>Payment Date</label><div>{formatDateID(payment.date)}</div></div>
                    <div className="dense-field"><label>Method</label><div>{payment.method}</div></div>
                    <div className="dense-field"><label>Deposit To</label><div>-</div></div>
                    <div className="dense-amount">{formatIDR(payment.amount)}</div>
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
                                    <div className="detail-field"><label>Payment #</label><strong>{payment.id}</strong></div>
                                    <div className="detail-field"><label>Status</label><StatusTag status={payment.status === 'Completed' ? 'Success' : 'Warning'} label={payment.status} /></div>
                                    <div className="detail-field"><label>Customer</label><div>{payment.customerName}</div></div>
                                    <div className="detail-field"><label>Method</label><div>{payment.method}</div></div>
                                    <div className="detail-field"><label>Date</label><div>{formatDateID(payment.date)}</div></div>
                                    <div className="detail-field"><label>Total</label><strong>{formatIDR(payment.amount)}</strong></div>
                                </div>
                            )}
                            {detailTab === 'items' && (
                                <div className="workbench-scroll-table">
                                    <table className="invoice-workbench-table">
                                        <thead><tr><th>Invoice #</th><th>Date</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                                        <tbody><tr><td>{payment.invoiceId}</td><td>-</td><td className="text-right">{formatIDR(payment.amount)}</td><td>-</td></tr></tbody>
                                    </table>
                                </div>
                            )}
                            {detailTab === 'logistics' && (
                                <div className="detail-grid">
                                    <div className="detail-field"><label>Payment Date</label><strong>{formatDateID(payment.date)}</strong></div>
                                    <div className="detail-field"><label>Method</label><strong>{payment.method}</strong></div>
                                    <div className="detail-field"><label>Deposit To</label><div>-</div></div>
                                    <div className="detail-field"><label>Linked Invoice</label><div>{payment.invoiceId}</div></div>
                                </div>
                            )}
                            {detailTab === 'attachments' && <div className="attachment-empty">No attachments.</div>}
                            {detailTab === 'audit' && (
                                <ul className="audit-list">
                                    <li><div><strong>Payment recorded</strong></div><div>{formatDateID(payment.date)} • System</div></li>
                                    <li><div><strong>AR cleared against invoice {payment.invoiceId}</strong></div><div>{formatDateID(payment.date)} • Auto journal</div></li>
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

            <PrintPreviewModal
                isOpen={isPrintOpen}
                onClose={() => setIsPrintOpen(false)}
                title="Payment Receipt Preview"
                documentTitle={`Receipt_${payment.number || payment.id}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                <PaymentReceiptPrintTemplate payment={payment} direction="in" partyName={payment.customerName} company={company} options={printSettings} />
            </PrintPreviewModal>
        </div>
    );
};

export default PaymentDetailPane;
