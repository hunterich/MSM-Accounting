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
    subtotal?: number | string;
    discountAmount?: number | string;
    taxEnabled?: boolean;
    taxInclusive?: boolean;
    taxRate?: number | string;
    taxAmount?: number | string;
    charges?: Array<{ amount?: number | string }>;
    [key: string]: unknown;
}

interface InvoiceSummaryTabProps {
    invoice: InvoiceRecord;
}

const InvoiceSummaryTab: React.FC<InvoiceSummaryTabProps> = ({ invoice }) => {
    const chargesTotal = (invoice.charges ?? []).reduce((sum, charge) => sum + Number(charge.amount ?? 0), 0);
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
                <label>Items Subtotal</label>
                <strong>{formatIDR(invoice.subtotal ?? 0)}</strong>
            </div>
            {Number(invoice.discountAmount ?? 0) > 0 && (
                <div className="detail-field span-2">
                    <label>Invoice Discount</label>
                    <strong>- {formatIDR(invoice.discountAmount)}</strong>
                </div>
            )}
            {chargesTotal !== 0 && (
                <div className="detail-field span-2">
                    <label>Other Charges</label>
                    <strong>{formatIDR(chargesTotal)}</strong>
                </div>
            )}
            {invoice.taxEnabled !== false && Number(invoice.taxAmount ?? 0) !== 0 && (
                <div className="detail-field span-2">
                    <label>PPN {Number(invoice.taxRate ?? 0)}%{invoice.taxInclusive ? ' (included)' : ''}</label>
                    <strong>{formatIDR(invoice.taxAmount)}</strong>
                </div>
            )}
            <div className="detail-field span-2">
                <label>Invoice Total</label>
                <strong className="text-primary-500">{formatIDR(invoice.amount)}</strong>
            </div>
        </div>
    );
};

export default InvoiceSummaryTab;
