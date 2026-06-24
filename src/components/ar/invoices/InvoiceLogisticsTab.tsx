import React from 'react';
import { formatDateID } from '../../../utils/formatters';

interface InvoiceRecord {
    billingAddress?: string;
    shippingAddress?: string;
    poNumber?: string;
    shippingDate?: string;
    notes?: string;
    [key: string]: unknown;
}

interface InvoiceLogisticsTabProps {
    invoice: InvoiceRecord;
}

const InvoiceLogisticsTab: React.FC<InvoiceLogisticsTabProps> = ({ invoice }) => {
    return (
        <div className="detail-grid">
            <div className="detail-field span-2">
                <label>Billing Address</label>
                <div>{invoice.billingAddress || '-'}</div>
            </div>
            <div className="detail-field span-2">
                <label>Shipping Address</label>
                <div>{invoice.shippingAddress || '-'}</div>
            </div>
            <div className="detail-field">
                <label>PO Number</label>
                <div>{invoice.poNumber || '-'}</div>
            </div>
            <div className="detail-field">
                <label>Shipping Date</label>
                <div>{invoice.shippingDate ? formatDateID(invoice.shippingDate) : '-'}</div>
            </div>
            <div className="detail-field span-2">
                <label>Internal Notes</label>
                <div>{invoice.notes || '-'}</div>
            </div>
        </div>
    );
};

export default InvoiceLogisticsTab;
