import React from 'react';
import DocumentSettlementPanel from '../../documents/DocumentSettlementPanel';
import { formatDateID } from '../../../utils/formatters';

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
        <div className="space-y-4">
            <DocumentSettlementPanel kind="invoice" id={invoice.id} />
            <div className="detail-grid">
                <div className="detail-field">
                    <label>Issue Date</label>
                    <strong>{formatDateID(invoice.issueDate || invoice.date)}</strong>
                </div>
                <div className="detail-field">
                    <label>Due Date</label>
                    <strong>{formatDateID(invoice.dueDate)}</strong>
                </div>
            </div>
        </div>
    );
};

export default InvoiceSummaryTab;
