import React from 'react';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';

const InvoiceSummaryTab = ({ invoice }) => {
    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Invoice #</label>
                <strong>{invoice.number || invoice.id}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Status</label>
                <StatusTag status={invoice.status} />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Customer</label>
                <strong>{invoice.customerName}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Issue Date</label>
                <strong>{formatDateID(invoice.issueDate || invoice.date)}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Due Date</label>
                <strong>{formatDateID(invoice.dueDate)}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Currency</label>
                <strong>{invoice.currency || 'IDR'}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Total</label>
                <strong className="text-primary-500">{formatIDR(invoice.amount)}</strong>
            </div>
        </div>
    );
};

export default InvoiceSummaryTab;
