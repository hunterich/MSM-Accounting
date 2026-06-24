import React, { useState } from 'react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import InvoiceSummaryTab from './InvoiceSummaryTab';
import InvoiceItemsTab from './InvoiceItemsTab';
import InvoiceLogisticsTab from './InvoiceLogisticsTab';
import InvoiceAttachmentsTab from './InvoiceAttachmentsTab';
import InvoiceAuditJournalTab from './InvoiceAuditJournalTab';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';

const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'items', label: 'Items' },
    { id: 'logistics', label: 'Logistics' },
    { id: 'attachments', label: 'Attachments' },
    { id: 'audit', label: 'Audit / Journal' }
];

interface InvoiceRecord {
    id: string;
    number?: string;
    status?: string;
    customerName?: string;
    issueDate?: string;
    date?: string;
    currency?: string;
    amount?: number | string;
    [key: string]: unknown;
}

interface InvoiceDetailTabsProps {
    invoice: InvoiceRecord;
    onEdit?: () => void;
    onPrint?: () => void;
    canEdit?: boolean;
    canDelete?: boolean;
    canPrint?: boolean;
}

const InvoiceDetailTabs: React.FC<InvoiceDetailTabsProps> = ({ invoice, onEdit, onPrint, canEdit = true, canDelete = false, canPrint = true }) => {
    const [activeTab, setActiveTab] = useState('summary');

    const renderTabContent = () => {
        switch (activeTab) {
            case 'summary':
                return <InvoiceSummaryTab invoice={invoice} />;
            case 'items':
                return <InvoiceItemsTab invoice={invoice} />;
            case 'logistics':
                return <InvoiceLogisticsTab invoice={invoice} />;
            case 'attachments':
                return <InvoiceAttachmentsTab invoice={invoice} />;
            case 'audit':
                return <InvoiceAuditJournalTab invoice={invoice} />;
            default:
                return null;
        }
    };

    return (
        <div className="invoice-workbench-card dense-mode">
            <div className="dense-topbar">
                <div className="detail-header-title">
                    <h2 className="detail-header-h2">{invoice.number || invoice.id}</h2>
                    <StatusTag status={invoice.status} />
                </div>
                <div className="detail-header-actions">
                    {canPrint && (
                        <Button text="Print" size="small" variant="secondary" onClick={onPrint} />
                    )}
                    <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={onEdit} />
                </div>
            </div>

            <div className="dense-header-grid">
                <div className="dense-field">
                    <label>Customer</label>
                    <div>{invoice.customerName}</div>
                </div>
                <div className="dense-field">
                    <label>Date</label>
                    <div>{formatDateID(invoice.issueDate || invoice.date || '') || '-'}</div>
                </div>
                <div className="dense-field">
                    <label>Currency</label>
                    <div>{invoice.currency || 'IDR'}</div>
                </div>
                <div className="dense-field">
                    <label>No Faktur #</label>
                    <div>{invoice.number || invoice.id}</div>
                </div>
                <div className="dense-amount">
                    {formatIDR(invoice.amount)}
                </div>
            </div>

            <div className="dense-body">
                <div className="dense-main">
                    <div className="detail-tabs dense-tabs">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                className={`detail-tab ${activeTab === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <div className="detail-tab-content dense-content">
                        {renderTabContent()}
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
    );
};

export default InvoiceDetailTabs;
