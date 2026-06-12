import React from 'react';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';

interface InvoiceRecord {
    id?: string;
    number?: string;
    status?: string;
    customerName?: string;
    issueDate?: string;
    date?: string;
    dueDate?: string;
    currency?: string;
    amount?: number | string;
    [key: string]: unknown;
}

interface InvoiceSummaryTabProps {
    invoice: InvoiceRecord;
}

const InvoiceSummaryTab: React.FC<InvoiceSummaryTabProps> = ({ invoice }) => {
    return (
        <div className="detail-grid">
            <div className="detail-field">
                <label>Invoice #</label>
                <strong>{invoice.number || invoice.id}</strong>
            </div>
            <div className="detail-field">
                <label>Status</label>
                <StatusTag status={invoice.status} />
            </div>
            <div className="detail-field">
                <label>Customer</label>
                <strong>{invoice.customerName}</strong>
            </div>
            <div className="detail-field">
                <label>Issue Date</label>
                <strong>{formatDateID(invoice.issueDate || invoice.date)}</strong>
            </div>
            <div className="detail-field">
                <label>Due Date</label>
                <strong>{formatDateID(invoice.dueDate)}</strong>
            </div>
            <div className="detail-field">
                <label>Currency</label>
                <strong>{invoice.currency || 'IDR'}</strong>
            </div>
            <div className="detail-field span-2">
                <label>Total</label>
                <strong className="text-primary-500">{formatIDR(invoice.amount)}</strong>
            </div>
        </div>
    );
};

export default InvoiceSummaryTab;
