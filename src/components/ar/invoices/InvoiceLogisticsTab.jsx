import React from 'react';
import { formatDateID } from '../../../utils/formatters';

const InvoiceLogisticsTab = ({ invoice }) => {
    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Billing Address</label>
                <div>{invoice.billingAddress || '-'}</div>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Shipping Address</label>
                <div>{invoice.shippingAddress || '-'}</div>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">PO Number</label>
                <div>{invoice.poNumber || '-'}</div>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Shipping Date</label>
                <div>{invoice.shippingDate ? formatDateID(invoice.shippingDate) : '-'}</div>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Internal Notes</label>
                <div>{invoice.notes || '-'}</div>
            </div>
        </div>
    );
};

export default InvoiceLogisticsTab;
